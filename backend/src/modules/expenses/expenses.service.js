const prisma = require('../../config/prisma');
const AppError = require('../../utils/AppError');
const monthsService = require('../months/months.service');
const { assertSufficientBalance, lockUserBalance } = require('../_shared/balance');
const { todayUtcDate, isFutureDate } = require('../../utils/dateTime');
const { round2 } = require('../../utils/math');
const { getRequestWorkspaceType } = require('../../utils/requestContext');

function assertDateMatchesMonth(date, month) {
  const matches = date.getUTCMonth() + 1 === month.month && date.getUTCFullYear() === month.year;
  if (!matches) {
    throw new AppError('A data informada não pertence ao mês selecionado.', 422, 'DATE_OUTSIDE_MONTH');
  }
}

function dueDateFromDay(month, day) {
  const lastDayOfMonth = new Date(Date.UTC(month.year, month.month, 0)).getUTCDate();
  return new Date(Date.UTC(month.year, month.month - 1, Math.min(day, lastDayOfMonth)));
}

async function assertCategoryIsValid(userId, categoryId, client = prisma) {
  const category = await client.category.findFirst({
    where: { id: categoryId, type: 'expense', OR: [{ userId: null }, { userId }] },
  });
  if (!category) {
    throw new AppError('Categoria de despesa inválida.', 422, 'INVALID_CATEGORY');
  }
}

function withDerivedStatus(expense) {
  if (['pending', 'partial'].includes(expense.status) && expense.dueDate < todayUtcDate()) {
    return { ...expense, status: 'late' };
  }
  return expense;
}

/**
 * Contas em aberto de meses ANTERIORES ao selecionado ("atrasadas de julho").
 *
 * Por que não movemos a despesa de mês:
 *  - A data do lançamento é a COMPETÊNCIA. Uma conta de julho é de julho,
 *    mesmo paga em agosto — mudar o mês falsearia o histórico.
 *  - O mês fechado tem um retrato imutável. Mexer no conteúdo dele (ou criar
 *    uma cópia no mês novo) faria a mesma dívida ser contada duas vezes.
 * Então a conta continua onde nasceu e passa a ser EXIBIDA e PAGÁVEL a partir
 * do mês atual — que é o que o usuário precisa: não perder a conta de vista.
 *
 * Só entram despesas comuns (variável/fixa):
 *  - parcelas de DÍVIDA já rolam sozinhas (o não pago é somado à parcela
 *    seguinte na virada), então arrastá-las aqui contaria em dobro;
 *  - parcelas de CARTÃO são quitadas pagando a fatura.
 */
async function listOverdueFromPreviousMonths(userId, monthId) {
  const target = await monthsService.getMonthOrThrow(userId, monthId);

  return prisma.expense.findMany({
    where: {
      userId,
      deletedAt: null,
      // Inclui PARCELAS DE DÍVIDA ('priority'). É seguro e necessário:
      // quando o fechamento gera a próxima parcela, ele FECHA as anteriores
      // em aberto e soma o não pago à nova (rolagem) — então a única parcela
      // que continua aberta num mês passado é a de um plano já esgotado,
      // aquela que precisa ser levada adiante como atrasada. Sem isso, o
      // usuário era obrigado a voltar ao mês antigo para pagá-la.
      // Parcelas de CARTÃO seguem de fora: são quitadas pela fatura.
      type: { in: ['variable', 'fixed', 'priority'] },
      status: { in: ['pending', 'late', 'partial'] },
      month: {
        userId,
        OR: [
          { year: { lt: target.year } },
          { year: target.year, month: { lt: target.month } },
        ],
      },
    },
    include: {
      category: true,
      debt: { select: { id: true, description: true, remainingBalance: true, installmentsCount: true } },
      month: { select: { id: true, month: true, year: true, status: true } },
    },
    orderBy: [{ dueDate: 'asc' }],
  });
}

async function listExpenses(userId, monthId, type) {
  await monthsService.getMonthOrThrow(userId, monthId);
  const typeFilter = type === 'fixed'
    ? { fixedTemplateId: { not: null } }
    : type
      ? { type }
      : {};

  const rows = await prisma.expense.findMany({
    where: { userId, monthId, deletedAt: null, ...typeFilter },
    include: {
      category: true,
      debt: true,
      cardInvoice: { include: { card: true } },
      fixedTemplate: true,
    },
    orderBy: { dueDate: 'asc' },
  });
  return rows.map(withDerivedStatus);
}

// ---------------- Despesa Variável ----------------

async function createVariableExpense(userId, payload) {
  const month = await monthsService.getMonthOrThrow(userId, payload.monthId);
  monthsService.assertMonthIsOpen(month);
  assertDateMatchesMonth(payload.date, month);
  await assertCategoryIsValid(userId, payload.categoryId);

  // Crédito é sempre uma operação real de cartão: exige cartão, consome
  // limite e entra em fatura. Nunca é gravado apenas como etiqueta.
  if (payload.paymentMethod === 'credit') {
    if (!payload.cardId) {
      throw new AppError('Selecione o cartão de crédito.', 422, 'CARD_REQUIRED');
    }
    const cardPurchasesService = require('../cards/cardPurchases.service');
    const result = await cardPurchasesService.createCardPurchase(userId, {
      cardId: payload.cardId,
      categoryId: payload.categoryId,
      description: payload.description,
      totalValue: payload.value,
      installmentsCount: 1,
      startingInstallment: 1,
      // A data da compra (não a competência) decide a fatura.
      purchaseDate: payload.purchaseDate ?? payload.date,
    });
    // Devolve a despesa com a referência da fatura onde ela caiu, para a
    // tela confirmar "registrada na fatura de MÊS/ANO — ver no cartão".
    return { ...result.expenses[0], cardInvoiceRef: result.firstInvoice ?? null };
  }

  // A data escolhida é competência/vencimento. Se o usuário marcar como
  // paga, o dinheiro sai AGORA e `paidAt` registra a data financeira atual
  // do workspace (real ou simulado), nunca uma data futura de competência.

  if (!payload.paid) {
    return prisma.expense.create({
      data: {
        userId,
        monthId: payload.monthId,
        type: 'variable',
        description: payload.description,
        categoryId: payload.categoryId,
        dueDate: payload.date,
        value: payload.value,
        paidAmount: 0,
        status: 'pending',
        paymentMethod: null,
        observation: payload.observation,
      },
      include: { category: true },
    });
  }

  return prisma.$transaction(async (tx) => {
    await lockUserBalance(tx, userId);
    await assertSufficientBalance(userId, payload.value, tx);
    return tx.expense.create({
      data: {
        userId,
        monthId: payload.monthId,
        type: 'variable',
        description: payload.description,
        categoryId: payload.categoryId,
        dueDate: payload.date,
        value: payload.value,
        paidAmount: payload.value,
        paidAt: todayUtcDate(),
        status: 'paid',
        paymentMethod: payload.paymentMethod,
        observation: payload.observation,
      },
      include: { category: true },
    });
  });
}

// ---------------- Despesa Fixa ----------------

async function createFixedExpense(userId, payload) {
  const month = await monthsService.getMonthOrThrow(userId, payload.monthId);
  monthsService.assertMonthIsOpen(month);
  await assertCategoryIsValid(userId, payload.categoryId);

  const isCard = payload.paymentMethod === 'credit';
  let card = null;

  if (isCard) {
    const cardsService = require('../cards/cards.service');
    card = await cardsService.getOwnedCardOrThrow(userId, payload.cardId);
    if (!card.active) {
      throw new AppError('Este cartão está desativado e não aceita novas despesas.', 409, 'CARD_INACTIVE');
    }
  }

  // Em despesa fixa no cartão, `dueDay` representa o DIA REAL DA
  // COBRANÇA recorrente (ex.: streaming cobra todo dia 5). Esse dia é
  // comparado ao fechamento do cartão por createFixedCardCharge para decidir
  // a fatura correta. O vencimento da fatura continua vindo exclusivamente
  // do cartão — nunca deve substituir a data da cobrança.
  const effectiveDueDay = Number(payload.dueDay);
  const dueDate = dueDateFromDay(month, effectiveDueDay);

  return prisma.$transaction(async (tx) => {
    const template = await tx.fixedExpenseTemplate.create({
      data: {
        userId,
        description: payload.description,
        categoryId: payload.categoryId,
        value: payload.value,
        dueDay: effectiveDueDay,
        paymentMethod: payload.paymentMethod,
        cardId: isCard ? payload.cardId : null,
        active: true,
      },
    });

    if (isCard) {
      const cardPurchasesService = require('../cards/cardPurchases.service');
      const { expense } = await cardPurchasesService.createFixedCardCharge({
        userId,
        card,
        template,
        month,
        dueDate,
        observation: payload.observation,
        client: tx,
      });
      return expense;
    }

    return tx.expense.create({
      data: {
        userId,
        monthId: month.id,
        type: 'fixed',
        description: payload.description,
        categoryId: payload.categoryId,
        dueDate,
        competenceMonth: month.month,
        competenceYear: month.year,
        value: payload.value,
        status: 'pending',
        fixedTemplateId: template.id,
        paymentMethod: payload.paymentMethod,
        observation: payload.observation,
      },
      include: { category: true, fixedTemplate: true },
    });
  });
}

async function deactivateFixedTemplate(userId, templateId) {
  const template = await prisma.fixedExpenseTemplate.findFirst({ where: { id: templateId, userId } });
  if (!template) throw new AppError('Despesa fixa não encontrada.', 404, 'FIXED_TEMPLATE_NOT_FOUND');
  return prisma.fixedExpenseTemplate.update({ where: { id: templateId }, data: { active: false } });
}

async function updateFixedTemplate(userId, templateId, payload) {
  if (payload.categoryId) await assertCategoryIsValid(userId, payload.categoryId);

  return prisma.$transaction(async (tx) => {
    const template = await tx.fixedExpenseTemplate.findFirst({ where: { id: templateId, userId } });
    if (!template) throw new AppError('Despesa fixa não encontrada.', 404, 'FIXED_TEMPLATE_NOT_FOUND');

    const effectiveMethod = payload.paymentMethod ?? template.paymentMethod;
    const effectiveCardId = payload.cardId !== undefined ? payload.cardId : template.cardId;
    let card = null;

    if (effectiveMethod === 'credit') {
      if (!effectiveCardId) throw new AppError('Selecione o cartão de crédito.', 422, 'CARD_REQUIRED');
      const cardsService = require('../cards/cards.service');
      card = await cardsService.getOwnedCardOrThrow(userId, effectiveCardId, tx);
      if (!card.active) {
        throw new AppError('Este cartão está desativado e não aceita novas despesas.', 409, 'CARD_INACTIVE');
      }
    }

    // Sincroniza apenas ocorrências ainda não pagas e em meses abertos.
    // Histórico pago/parcial e meses fechados permanecem imutáveis.
    const openInstances = await tx.expense.findMany({
      where: {
        fixedTemplateId: templateId,
        month: { status: 'open' },
        status: { in: ['pending', 'late'] },
        paidAmount: 0,
      },
      include: { month: true },
    });

    const instanceIds = openInstances.map((item) => item.id);
    if (instanceIds.length > 0) {
      await tx.expense.deleteMany({ where: { id: { in: instanceIds } } });
    }

    const oldInvoiceIds = [...new Set(
      openInstances.filter((item) => item.cardInvoiceId).map((item) => String(item.cardInvoiceId))
    )];
    const cardPurchasesService = require('../cards/cardPurchases.service');
    for (const invoiceId of oldInvoiceIds) {
      await cardPurchasesService.recalculateInvoiceTotal(BigInt(invoiceId), tx);
    }

    const updatedTemplate = await tx.fixedExpenseTemplate.update({
      where: { id: templateId },
      data: {
        ...(payload.description && { description: payload.description }),
        ...(payload.value !== undefined && { value: payload.value }),
        ...(payload.categoryId && { categoryId: payload.categoryId }),
        // Sempre é o dia da obrigação/cobrança. No crédito, ele decide
        // em qual ciclo a compra entra; o vencimento continua vindo do cartão.
        ...(payload.dueDay !== undefined && { dueDay: Number(payload.dueDay) }),
        ...(payload.paymentMethod && { paymentMethod: payload.paymentMethod }),
        cardId: effectiveMethod === 'credit' ? effectiveCardId : null,
      },
      include: { category: true },
    });

    for (const previous of openInstances) {
      const dueDate = dueDateFromDay(previous.month, Number(updatedTemplate.dueDay));
      if (effectiveMethod === 'credit') {
        await cardPurchasesService.createFixedCardCharge({
          userId,
          card,
          template: updatedTemplate,
          month: previous.month,
          dueDate,
          observation: previous.observation,
          client: tx,
        });
      } else {
        await tx.expense.create({
          data: {
            userId,
            monthId: previous.month.id,
            type: 'fixed',
            description: updatedTemplate.description,
            categoryId: updatedTemplate.categoryId,
            dueDate,
            competenceMonth: previous.competenceMonth ?? previous.month.month,
            competenceYear: previous.competenceYear ?? previous.month.year,
            value: updatedTemplate.value,
            paidAmount: 0,
            status: dueDate < todayUtcDate() ? 'late' : 'pending',
            fixedTemplateId: updatedTemplate.id,
            paymentMethod: effectiveMethod,
            observation: previous.observation,
          },
        });
      }
    }

    return updatedTemplate;
  });
}

async function deleteFixedTemplate(userId, templateId) {
  const template = await prisma.fixedExpenseTemplate.findFirst({ where: { id: templateId, userId } });
  if (!template) throw new AppError('Despesa fixa não encontrada.', 404, 'FIXED_TEMPLATE_NOT_FOUND');

  return prisma.$transaction(async (tx) => {
    const removable = await tx.expense.findMany({
      where: {
        fixedTemplateId: templateId,
        status: { in: ['pending', 'late'] },
        paidAmount: 0,
        month: { status: 'open' },
      },
      select: { id: true, cardInvoiceId: true },
    });

    const ids = removable.map((expense) => expense.id);
    if (ids.length > 0) await tx.expense.deleteMany({ where: { id: { in: ids } } });

    const invoiceIds = [...new Set(removable.filter((e) => e.cardInvoiceId).map((e) => String(e.cardInvoiceId)))];
    const cardPurchasesService = require('../cards/cardPurchases.service');
    for (const invoiceId of invoiceIds) {
      await cardPurchasesService.recalculateInvoiceTotal(BigInt(invoiceId), tx);
    }

    const instanceCount = await tx.expense.count({ where: { fixedTemplateId: templateId } });
    if (instanceCount > 0) {
      return tx.fixedExpenseTemplate.update({ where: { id: templateId }, data: { active: false } });
    }
    return tx.fixedExpenseTemplate.delete({ where: { id: templateId } });
  });
}

// ---------------- Edição / exclusão ----------------

async function getOwnedExpenseOrThrow(userId, expenseId, client = prisma) {
  const expense = await client.expense.findFirst({
    where: { id: expenseId, userId, deletedAt: null },
    include: { month: true, debt: true },
  });
  if (!expense) throw new AppError('Despesa não encontrada.', 404, 'EXPENSE_NOT_FOUND');
  return expense;
}

function assertEditableType(expense) {
  if (expense.type === 'card') {
    throw new AppError(
      'Lançamentos de cartão não podem ser editados/excluídos diretamente — gerencie a compra ou a despesa fixa de origem.',
      409,
      'EXPENSE_TYPE_NOT_EDITABLE'
    );
  }
}

function assertValueIsEditable(expense, payload) {
  if (expense.type === 'priority' && payload.value !== undefined) {
    throw new AppError(
      'O valor da parcela é controlado pela dívida de origem e não pode ser editado diretamente.',
      409,
      'INSTALLMENT_VALUE_NOT_EDITABLE'
    );
  }
}

async function updateExpense(userId, expenseId, payload) {
  const initial = await getOwnedExpenseOrThrow(userId, expenseId);
  assertEditableType(initial);
  assertValueIsEditable(initial, payload);
  monthsService.assertMonthIsOpen(initial.month);

  const initialEffectiveDate = payload.dueDate ?? initial.dueDate;
  assertDateMatchesMonth(initialEffectiveDate, initial.month);
  if (payload.categoryId) await assertCategoryIsValid(userId, payload.categoryId);

  if (initial.status === 'reversed' || Number(initial.reversedAmount ?? 0) > 0) {
    throw new AppError('Esta despesa já foi estornada e não pode ser editada.', 409, 'EXPENSE_ALREADY_REVERSED');
  }

  const isAlreadyPaid = ['paid', 'settled', 'flex_paid'].includes(initial.status);
  const rewritesPaidFact = isAlreadyPaid && (payload.value !== undefined || payload.dueDate);
  if (rewritesPaidFact && getRequestWorkspaceType() !== 'simulation') {
    throw new AppError(
      'No financeiro real, valor e data de uma despesa paga não podem ser reescritos. Estorne o pagamento e registre a correção.',
      409,
      'PAID_EXPENSE_FINANCIAL_FIELDS_IMMUTABLE'
    );
  }
  if (['partial', 'flex_paid'].includes(initial.status) && (payload.value !== undefined || payload.dueDate)) {
    throw new AppError(
      'Não é possível alterar valor ou data de uma parcela que já recebeu pagamento — isso quebraria a conta do saldo residual.',
      409,
      'PARTIALLY_PAID_EXPENSE_IMMUTABLE'
    );
  }

  if (!isAlreadyPaid) {
    return prisma.expense.update({
      where: { id: expenseId },
      data: {
        ...(payload.description && { description: payload.description }),
        ...(payload.value !== undefined && { value: payload.value }),
        ...(payload.categoryId && { categoryId: payload.categoryId }),
        ...(payload.dueDate && {
          dueDate: payload.dueDate,
          status: payload.dueDate < todayUtcDate() ? 'late' : 'pending',
        }),
        ...(payload.observation !== undefined && { observation: payload.observation }),
      },
      include: { category: true },
    });
  }

  return prisma.$transaction(async (tx) => {
    await lockUserBalance(tx, userId);
    const expense = await getOwnedExpenseOrThrow(userId, expenseId, tx);
    assertEditableType(expense);
    assertValueIsEditable(expense, payload);
    monthsService.assertMonthIsOpen(expense.month);

    const effectiveDate = payload.dueDate ?? expense.dueDate;
    const effectiveValue = payload.value !== undefined ? Number(payload.value) : Number(expense.value);
    // A data é competência, não a data do caixa (mesma regra das receitas):
    // basta estar dentro do mês selecionado, mesmo que seja "futura" em
    // relação a hoje. `assertDateMatchesMonth` já impede datas fora do mês.
    assertDateMatchesMonth(effectiveDate, expense.month);

    const additionalConsumption = round2(effectiveValue - Number(expense.paidAmount));
    if (additionalConsumption > 0) {
      await assertSufficientBalance(userId, additionalConsumption, tx);
    }

    return tx.expense.update({
      where: { id: expenseId },
      data: {
        ...(payload.description && { description: payload.description }),
        ...(payload.value !== undefined && { value: payload.value, paidAmount: payload.value }),
        ...(payload.categoryId && { categoryId: payload.categoryId }),
        ...(payload.dueDate && { dueDate: payload.dueDate }),
        ...(payload.observation !== undefined && { observation: payload.observation }),
      },
      include: { category: true },
    });
  });
}

async function deleteExpense(userId, expenseId) {
  return prisma.$transaction(async (tx) => {
    await lockUserBalance(tx, userId);
    const expense = await getOwnedExpenseOrThrow(userId, expenseId, tx);
    assertEditableType(expense);
    if (expense.type === 'priority') {
      throw new AppError(
        'Parcelas de dívida não podem ser excluídas individualmente — exclua ou renegocie a dívida de origem.',
        409,
        'EXPENSE_TYPE_NOT_EDITABLE'
      );
    }
    if (expense.status === 'reversed' || Number(expense.reversedAmount ?? 0) > 0) {
      throw new AppError('Esta despesa já foi estornada.', 409, 'EXPENSE_ALREADY_REVERSED');
    }

    const paid = Number(expense.paidAmount ?? 0);
    if (paid > 0.009 || expense.paidAt) {
      if (getRequestWorkspaceType() === 'simulation') {
        // Simulação é reversível: em um período reaberto, remover uma conta
        // deve desfazer seu efeito e permitir o recálculo, sem criar um estorno
        // permanente como no ledger real. O soft delete mantém vínculos/IDs.
        monthsService.assertMonthIsOpen(expense.month);
        return tx.expense.update({
          where: { id: expense.id },
          data: { deletedAt: new Date() },
        });
      }
      // No financeiro real nunca se apaga o fato financeiro. O estorno devolve
      // o valor ao saldo e mantém pagamento/data disponíveis para auditoria.
      return tx.expense.update({
        where: { id: expense.id },
        data: {
          status: 'reversed',
          reversedAt: todayUtcDate(),
          reversedAmount: paid,
        },
      });
    }

    // Rascunho/pendência sem efeito no caixa só pode ser removido enquanto o
    // mês de competência estiver aberto. Estorno de pagamento antigo acima é
    // permitido porque cria um fato novo na data atual, sem reescrever o mês.
    monthsService.assertMonthIsOpen(expense.month);
    // Rascunho/pendência sem efeito no caixa: soft delete, preservando IDs e
    // evitando quebra de referências técnicas.
    return tx.expense.update({
      where: { id: expense.id },
      data: { deletedAt: new Date() },
    });
  });
}

// ---------------- Pagamento ----------------

async function payExpense(userId, expenseId, { amount, paymentMethod }) {
  const initial = await getOwnedExpenseOrThrow(userId, expenseId);
  // NOTA (auditoria): pagar uma conta de um mês JÁ ENCERRADO é permitido de
  // propósito. O fechamento não arrasta pendências para o mês seguinte —
  // elas continuam no mês de competência. Bloquear o pagamento tornaria essa
  // conta impagável para sempre. O histórico continua correto porque o
  // retrato do mês fechado é imutável e `paidAt` registra a data real da
  // saída de dinheiro (hoje), não a competência.
  if (initial.type === 'card') {
    throw new AppError('Parcelas de cartão são quitadas pagando a fatura inteira.', 409, 'PAY_VIA_INVOICE');
  }
  if (initial.type === 'priority') {
    const debtsService = require('../debts/debts.service');
    return debtsService.applyPaymentToInstallment(userId, initial, amount, paymentMethod);
  }
  if (paymentMethod === 'credit') {
    throw new AppError('Não é possível quitar uma conta com “crédito” sem criar uma nova cobrança em cartão.', 422, 'INVALID_PAYMENT_METHOD');
  }
  if (Math.abs(amount - Number(initial.value)) > 0.009) {
    throw new AppError(
      'Esta despesa exige pagamento do valor exato. Para pagamento flexível, use uma despesa de prioridade.',
      422,
      'EXACT_PAYMENT_REQUIRED'
    );
  }

  return prisma.$transaction(async (tx) => {
    await lockUserBalance(tx, userId);
    const expense = await getOwnedExpenseOrThrow(userId, expenseId, tx);
    // 'flex_paid' também encerra a obrigação do mês. Se ainda houver saldo
    // residual, ele é quitado pela ação própria da parcela (que sabe reduzir
    // o acréscimo da parcela seguinte), nunca por este caminho genérico.
    if (['paid', 'settled', 'flex_paid'].includes(expense.status)) {
      throw new AppError('Esta despesa já está paga.', 409, 'EXPENSE_ALREADY_PAID');
    }
    await assertSufficientBalance(userId, amount, tx);

    return {
      expense: await tx.expense.update({
        where: { id: expenseId },
        data: {
          paidAmount: amount,
          paidAt: todayUtcDate(),
          status: 'paid',
          paymentMethod,
        },
        include: { category: true },
      }),
      debt: null,
    };
  });
}

module.exports = {
  listExpenses,
  listOverdueFromPreviousMonths,
  createVariableExpense,
  createFixedExpense,
  deactivateFixedTemplate,
  updateFixedTemplate,
  deleteFixedTemplate,
  updateExpense,
  deleteExpense,
  payExpense,
  dueDateFromDay,
  assertCategoryIsValid,
  assertDateMatchesMonth,
};
