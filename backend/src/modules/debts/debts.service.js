const prisma = require('../../config/prisma');
const AppError = require('../../utils/AppError');
const monthsService = require('../months/months.service');
const expensesService = require('../expenses/expenses.service');
const { recordAuditLog } = require('../auditLog/auditLog.service');
const { round2 } = require('../../utils/math');
const { assertSufficientBalance, lockUserBalance } = require('../_shared/balance');
const { todayUtcDate } = require('../../utils/dateTime');

// Tolerância única de centavos para decidir quitação. Um único ponto de
// verdade evita que um trecho considere a dívida quitada e outro não.
const SETTLE_TOLERANCE = 0.009;

/**
 * Parcelas que ainda faltam, derivadas do SALDO DEVEDOR REAL — nunca de
 * `installmentsCount - parcelasGeradas`. Uma dívida com pagamento flexível
 * pode ter esgotado o plano original e ainda dever dinheiro; nesse caso ela
 * continua ativa e ganha parcelas residuais.
 */
function remainingInstallmentsFor(debt) {
  const balance = Number(debt.remainingBalance);
  if (balance <= SETTLE_TOLERANCE) return 0;
  const nominal = Number(debt.installmentValue);
  if (!(nominal > 0)) return 1;
  return Math.max(Math.ceil(round2(balance) / nominal), 1);
}

/**
 * O valor de cada parcela nunca é "total / parcelas" fixo e cego — é sempre
 * recalculado em cima do saldo devedor real. Isso é o que faz pagamento
 * flexível e quitação antecipada funcionarem sem nenhuma tabela extra de
 * "parcelas futuras": a última parcela (installmentsRemaining <= 1) sempre
 * absorve o saldo devedor inteiro, eliminando resíduo de arredondamento e
 * incorporando automaticamente qualquer diferença para mais ou para menos.
 *
 * `carryOver` é o ajuste vindo do pagamento da parcela ANTERIOR (positivo =
 * pagou a menos, a próxima parcela sobe; negativo = pagou a mais, a próxima
 * parcela desce) — ver applyPaymentToInstallment. Não se aplica à parcela
 * final: ali o saldo devedor já reflete tudo corretamente por si só.
 */
function computeInstallmentValue(remainingBalance, installmentsRemaining, nominalValue, carryOver = 0) {
  const balance = Number(remainingBalance);
  if (installmentsRemaining <= 1) {
    return round2(Math.max(balance, 0));
  }
  const target = Number(nominalValue) + Number(carryOver);
  return round2(Math.min(Math.max(target, 0), balance));
}

async function createDebt(userId, payload) {
  const month = await monthsService.getMonthOrThrow(userId, payload.monthId);
  monthsService.assertMonthIsOpen(month);
  await expensesService.assertCategoryIsValid(userId, payload.categoryId);

  const nominalValue = round2(payload.totalValue / payload.installmentsCount);
  const startingInstallment = payload.startingInstallment ?? 1;

  // Registrando uma compra que já está em andamento (ex.: "já estou na
  // parcela 4 de 12"): a dívida nasce já considerando só o que falta —
  // (installmentsCount - startingInstallment + 1) parcelas, com o saldo
  // devedor já descontado do que as parcelas anteriores já cobriram. Não
  // recria as parcelas 1..(startingInstallment-1) no histórico (elas
  // aconteceram antes de existir registro no app).
  const remainingInstallments = payload.installmentsCount - startingInstallment + 1;
  const startingRemainingBalance = round2(payload.totalValue - nominalValue * (startingInstallment - 1));

  const firstInstallmentValue = computeInstallmentValue(
    startingRemainingBalance,
    remainingInstallments,
    nominalValue
  );

  const label = startingInstallment > 1
    ? `${payload.description} (${startingInstallment}/${payload.installmentsCount})`
    : `${payload.description} (1/${payload.installmentsCount})`;

  return prisma.$transaction(async (tx) => {
    const debt = await tx.debt.create({
      data: {
        userId,
        description: payload.description,
        categoryId: payload.categoryId,
        totalValue: startingRemainingBalance,
        installmentsCount: remainingInstallments,
        installmentValue: nominalValue,
        flexiblePayment: payload.flexiblePayment,
        dueDay: payload.dueDay,
        status: 'active',
        remainingBalance: startingRemainingBalance,
      },
    });

    const expense = await tx.expense.create({
      data: {
        userId,
        monthId: payload.monthId,
        type: 'priority',
        description: label,
        categoryId: payload.categoryId,
        dueDate: expensesService.dueDateFromDay(month, payload.dueDay),
        value: firstInstallmentValue,
        status: 'pending',
        debtId: debt.id,
      },
      include: { category: true },
    });

    return { debt, expense };
  }).then(async (result) => {
    // Depois do commit — nunca dentro da transação (ver auditLog.service.js).
    await recordAuditLog(userId, 'debt', result.debt.id, 'create', { newValue: result.debt });
    return result;
  });
}

async function listDebts(userId) {
  // Marca como ATRASADA toda parcela de dívida vencida e ainda não paga
  // (em meses abertos). Assim o Dashboard e a lista de dívidas mostram o
  // atraso de verdade, em vez de "pendente" para sempre.
  await prisma.expense.updateMany({
    where: {
      userId,
      debtId: { not: null },
      deletedAt: null,
      status: { in: ['pending', 'partial'] },
      dueDate: { lt: todayUtcDate() },
      month: { status: 'open' },
    },
    data: { status: 'late' },
  });

  const debts = await prisma.debt.findMany({
    where: { userId },
    include: { category: true, _count: { select: { expenses: true } } },
    orderBy: { createdAt: 'desc' },
  });

  return debts.map((debt) => {
    const installmentsGenerated = debt._count.expenses;
    return {
      ...debt,
      valuePaid: round2(Number(debt.totalValue) - Number(debt.remainingBalance)),
      installmentsGenerated,
      // Derivado do saldo devedor real (ver remainingInstallmentsFor).
      installmentsRemaining: remainingInstallmentsFor(debt),
      isFullySettled: Number(debt.remainingBalance) <= SETTLE_TOLERANCE,
      _count: undefined,
    };
  });
}

async function getDebtOrThrow(userId, debtId, client = prisma) {
  const debt = await client.debt.findFirst({ where: { id: debtId, userId } });
  if (!debt) {
    throw new AppError('Dívida não encontrada.', 404, 'DEBT_NOT_FOUND');
  }
  return debt;
}

/**
 * Edita apenas metadados da dívida (descrição, categoria, dia de
 * vencimento, flag de pagamento flexível) — nunca o valor total ou número
 * de parcelas, porque mudar isso depois de já existirem parcelas geradas
 * exigiria reabrir o cálculo de installmentValue/remainingBalance e
 * potencialmente reescrever parcelas de meses já fechados (proibido).
 * Quem precisar mudar valor/parcelas deve quitar e recriar a dívida.
 */
async function updateDebt(userId, debtId, payload) {
  const debt = await getDebtOrThrow(userId, debtId);

  if (payload.categoryId) {
    await expensesService.assertCategoryIsValid(userId, payload.categoryId);
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.debt.update({
      where: { id: debtId },
      data: {
        ...(payload.description && { description: payload.description }),
        ...(payload.categoryId && { categoryId: payload.categoryId }),
        ...(payload.dueDay !== undefined && { dueDay: payload.dueDay }),
        ...(payload.flexiblePayment !== undefined && { flexiblePayment: payload.flexiblePayment }),
      },
      include: { category: true },
    });

    // Reflete descrição/categoria/vencimento na(s) parcela(s) ainda em
    // aberto em meses abertos — a parcela é uma "foto" da dívida no
    // momento em que foi gerada, então mantê-la sincronizada com os
    // metadados atuais da dívida evita que a tela mostre categoria/dia
    // de vencimento antigos depois de uma edição.
    if (payload.description || payload.categoryId || payload.dueDay !== undefined) {
      const openInstallments = await tx.expense.findMany({
        where: { debtId, status: { in: ['pending', 'late'] }, paidAmount: 0, month: { status: 'open' } },
        include: { month: true },
      });
      for (const installment of openInstallments) {
        await tx.expense.update({
          where: { id: installment.id },
          data: {
            ...(payload.categoryId && { categoryId: payload.categoryId }),
            ...(payload.dueDay !== undefined && (() => {
              const dueDate = expensesService.dueDateFromDay(installment.month, payload.dueDay);
              return { dueDate, status: dueDate < todayUtcDate() ? 'late' : 'pending' };
            })()),
            ...(payload.description && {
              description: installment.description.replace(
                /^.*(\(\d+\/\d+\))$/,
                `${payload.description} $1`
              ),
            }),
          },
        });
      }
    }

    return updated;
  }).then(async (updated) => {
    await recordAuditLog(userId, 'debt', debtId, 'update', { oldValue: debt, newValue: updated });
    return updated;
  });
}

/**
 * Encerra a dívida (status -> settled, parando geração de parcelas
 * futuras no próximo fechamento) e remove na hora a parcela do mês atual
 * se ela ainda não foi paga — espelha exatamente o que já é feito para
 * despesa fixa. Parcelas já pagas em qualquer mês (incluindo o atual)
 * nunca são tocadas: são histórico financeiro de algo que já aconteceu.
 */
async function deleteDebt(userId, debtId) {
  const debt = await getDebtOrThrow(userId, debtId);

  return prisma.$transaction(async (tx) => {
    // Parcelas SEM nenhum pagamento (em meses abertos) são apagadas — não
    // afetam o saldo, pois nada foi pago nelas.
    await tx.expense.deleteMany({
      where: { debtId, paidAmount: 0, status: { in: ['pending', 'late'] }, month: { status: 'open' } },
    });

    // Parcelas com pagamento PARCIAL não podem ser apagadas: o saldo conta o
    // `paidAmount`, então apagá-las DEVOLVERIA o dinheiro pago (bug). Em vez
    // disso, são FECHADAS: o valor é reduzido ao que já foi pago e viram
    // 'paid'. Assim o dinheiro pago continua contabilizado e não sobra
    // nenhuma parte "em aberto" órfã depois que a dívida some.
    const partials = await tx.expense.findMany({
      where: { debtId, paidAmount: { gt: 0 }, status: { in: ['pending', 'late', 'partial'] }, month: { status: 'open' } },
      select: { id: true, paidAmount: true },
    });
    for (const inst of partials) {
      await tx.expense.update({
        where: { id: inst.id },
        data: { value: round2(Number(inst.paidAmount ?? 0)), status: 'paid' },
      });
    }

    return tx.debt.update({ where: { id: debtId }, data: { status: 'settled' } });
  }).then(async (updated) => {
    await recordAuditLog(userId, 'debt', debtId, 'delete', { oldValue: debt, newValue: updated });
    return updated;
  });
}

/**
 * Pagamento de uma parcela de dívida (flexível).
 * Chamado por expenses.service.payExpense quando expense.type === 'priority'.
 *
 * MODELO ATUAL (pagamento parcial acumulável):
 *  - Você pode pagar uma parcela em VÁRIAS vezes (top-up) até completá-la;
 *    `paidAmount` acumula e o saldo devedor cai a cada pagamento.
 *  - O que sobrar sem pagar não fica "perdido": ao fechar o mês, a rolagem
 *    em `generateNextInstallment` soma o não pago à parcela seguinte.
 *  - Só uma parcela TOTALMENTE paga recusa novo pagamento.
 *
 * (Observação histórica: um segundo pagamento aqui NÃO contaria a mesma
 * diferença duas vezes.
 */
async function applyPaymentToInstallment(userId, expense, amount, paymentMethod) {
  if (paymentMethod === 'credit') {
    throw new AppError('Pagamento de dívida com cartão precisa ser registrado como uma nova compra no cartão.', 422, 'INVALID_PAYMENT_METHOD');
  }

  return prisma.$transaction(async (tx) => {
    await lockUserBalance(tx, userId);

    const currentExpense = await tx.expense.findFirst({
      where: { id: expense.id, userId, deletedAt: null },
    });
    if (!currentExpense) throw new AppError('Despesa não encontrada.', 404, 'EXPENSE_NOT_FOUND');

    const debt = await getDebtOrThrow(userId, currentExpense.debtId, tx);
    const remainingBalance = Number(debt.remainingBalance);
    const estimated = Number(currentExpense.value);
    const alreadyPaid = Number(currentExpense.paidAmount ?? 0);
    const residual = Number(currentExpense.residualAmount ?? 0);

    // ── CAMINHO 1: quitar o SALDO RESIDUAL de uma parcela já encerrada ──
    // Uma parcela flexível encerrada com resíduo NÃO responde "já paga": o
    // usuário pode voltar e quitar o que ficou, quando quiser.
    if (currentExpense.status === 'flex_paid' && residual > SETTLE_TOLERANCE) {
      return settleResidualWithin(tx, { userId, currentExpense, debt, amount, paymentMethod });
    }

    if (['paid', 'settled', 'flex_paid'].includes(currentExpense.status)) {
      throw new AppError('Esta parcela já está quitada.', 409, 'INSTALLMENT_ALREADY_PAID');
    }

    const outstanding = round2(estimated - alreadyPaid);
    const maxPayable = round2(Math.min(outstanding, remainingBalance));

    if (amount > maxPayable + SETTLE_TOLERANCE) {
      throw new AppError(
        `O valor é maior do que falta nesta parcela (R$ ${maxPayable.toFixed(2)}).`,
        422,
        'PAYMENT_ABOVE_INSTALLMENT',
        { installmentOutstanding: maxPayable, requestedAmount: round2(amount) }
      );
    }

    const isShortfall = amount < maxPayable - SETTLE_TOLERANCE;
    if (isShortfall && !debt.flexiblePayment) {
      throw new AppError(
        'Esta dívida exige pagamento exato da parcela (pagamento flexível desativado).',
        422,
        'EXACT_PAYMENT_REQUIRED'
      );
    }

    await assertSufficientBalance(userId, amount, tx);

    const newPaidAmount = round2(alreadyPaid + amount);
    const newRemainingBalance = round2(Math.max(remainingBalance - amount, 0));
    const isSettled = newRemainingBalance <= SETTLE_TOLERANCE;
    const coversEstimate = newPaidAmount >= estimated - SETTLE_TOLERANCE;

    // ── CAMINHO 2: pagamento normal ou FLEXÍVEL ──
    // Pagar menos que o estimado numa dívida flexível ENCERRA a obrigação do
    // mês. O valor era estimado, não mínimo: continuar cobrando aquela parcela
    // como vencida seria punir quem pagou o combinado.
    let newStatus;
    let newResidual = 0;
    if (isSettled || coversEstimate) {
      newStatus = 'paid';
    } else {
      newStatus = 'flex_paid';
      newResidual = round2(estimated - newPaidAmount);
    }

    const updatedExpense = await tx.expense.update({
      where: { id: currentExpense.id },
      data: {
        paidAmount: newPaidAmount,
        paidAt: todayUtcDate(),
        status: newStatus,
        paymentMethod,
        residualAmount: newResidual,
        ...(newResidual <= 0 ? { residualSettledAt: null } : {}),
      },
      include: { category: true },
    });

    // Se esta parcela carregava resíduos de meses anteriores e foi quitada,
    // esses resíduos foram pagos JUNTO — zerar evita que continuem cobráveis
    // e sendo somados de novo na próxima virada.
    if (newStatus === 'paid') {
      await tx.expense.updateMany({
        where: { carriedToExpenseId: currentExpense.id, residualAmount: { gt: 0 } },
        data: { residualAmount: 0, residualSettledAt: todayUtcDate() },
      });
    }

    const updatedDebt = await tx.debt.update({
      where: { id: debt.id },
      data: {
        remainingBalance: newRemainingBalance,
        pendingCarryOver: 0,
        status: isSettled ? 'settled' : 'active',
      },
    });

    return {
      expense: updatedExpense,
      debt: updatedDebt,
      flexible: newStatus === 'flex_paid',
      residualAmount: newResidual,
    };
  });
}

/**
 * Quitação (total ou parcial) do saldo residual de uma parcela já encerrada.
 *
 * Regras que este trecho garante:
 *  - a parcela anterior NUNCA é reaberta;
 *  - não se paga acima do residual;
 *  - o acréscimo já lançado na parcela seguinte é reduzido junto, para o mesmo
 *    valor não ficar cobrado nos dois lugares.
 */
async function settleResidualWithin(tx, { userId, currentExpense, debt, amount, paymentMethod }) {
  const residual = Number(currentExpense.residualAmount ?? 0);
  const remainingBalance = Number(debt.remainingBalance);
  const maxPayable = round2(Math.min(residual, remainingBalance));

  if (amount > maxPayable + SETTLE_TOLERANCE) {
    throw new AppError(
      `O saldo residual desta parcela é de R$ ${maxPayable.toFixed(2)}.`,
      422,
      'PAYMENT_ABOVE_RESIDUAL',
      { residualAmount: maxPayable, requestedAmount: round2(amount) }
    );
  }

  await assertSufficientBalance(userId, amount, tx);

  const newResidual = round2(Math.max(residual - amount, 0));
  const fullySettled = newResidual <= SETTLE_TOLERANCE;

  const updatedExpense = await tx.expense.update({
    where: { id: currentExpense.id },
    data: {
      // paidAmount cresce: o dinheiro saiu por conta DESTA parcela.
      paidAmount: round2(Number(currentExpense.paidAmount ?? 0) + amount),
      residualAmount: fullySettled ? 0 : newResidual,
      residualSettledAt: fullySettled ? todayUtcDate() : null,
      // status permanece flex_paid: a parcela segue encerrada, não reabre.
    },
    include: { category: true },
  });

  // Se o resíduo já tinha sido somado à parcela seguinte, reduz lá também —
  // senão o mesmo valor ficaria cobrado duas vezes.
  if (currentExpense.carriedToExpenseId) {
    const next = await tx.expense.findFirst({
      where: { id: currentExpense.carriedToExpenseId, userId, deletedAt: null },
    });
    if (next && !['paid', 'settled'].includes(next.status)) {
      const reduced = round2(Math.max(Number(next.value) - amount, 0));
      await tx.expense.update({ where: { id: next.id }, data: { value: reduced } });
    }
  }

  const newRemainingBalance = round2(Math.max(remainingBalance - amount, 0));
  const isSettled = newRemainingBalance <= SETTLE_TOLERANCE;
  const updatedDebt = await tx.debt.update({
    where: { id: debt.id },
    data: { remainingBalance: newRemainingBalance, status: isSettled ? 'settled' : 'active' },
  });

  return {
    expense: updatedExpense,
    debt: updatedDebt,
    residualPayment: true,
    residualAmount: fullySettled ? 0 : newResidual,
  };
}

/**
 * Usado pela Etapa 15 (Fechamento Mensal, ainda não implementada) para
 * gerar a parcela do próximo mês de uma dívida ativa. Já implementado e
 * testável agora para travar a regra de negócio enquanto está fresca,
 * mesmo sem rota própria — fechamento mensal vai importar esta função
 * diretamente em vez de duplicar a lógica.
 */
async function generateNextInstallment(debt, month, client = prisma, options = {}) {
  if (debt.status === 'settled') return null;

  const remainingBalance = Number(debt.remainingBalance);

  // Quitação real: única condição de encerrar é o saldo devedor zerar.
  if (remainingBalance <= SETTLE_TOLERANCE) {
    await client.debt.update({
      where: { id: debt.id },
      data: { status: 'settled', pendingCarryOver: 0, remainingBalance: 0 },
    });
    return null;
  }

  const installmentsGenerated = options.installmentsGenerated
    ?? await client.expense.count({ where: { debtId: debt.id, deletedAt: null } });
  const plannedRemaining = debt.installmentsCount - installmentsGenerated;

  // O NÚMERO DE PARCELAS É FIXO. Se o plano acabou e ainda há saldo devedor,
  // o sistema NÃO inventa parcelas novas: a última permanece em aberto,
  // carregando todo o valor acumulado.
  //
  // Ela não fica "presa" no mês antigo: parcelas de dívida em aberto de meses
  // anteriores são levadas adiante e aparecem como ATRASADAS no mês corrente
  // (ver listOverdueFromPreviousMonths), podendo ser pagas a qualquer momento.
  // Criar parcelas novas só acontece se o usuário pedir, pela renegociação.
  if (plannedRemaining <= 0) return null;
  const isExtra = false;

  // ROLAGEM (regra do usuário): o que ficou em aberto nas parcelas
  // anteriores é SOMADO à parcela atual. As anteriores são "fechadas"
  // (marcadas como pagas pelo que foi efetivamente pago) porque seu saldo
  // passou para a parcela atual — assim não há dupla contagem e só a
  // parcela corrente carrega o valor acumulado.
  //
  // Ex.: dívida 2000 em 4x de 500. Paga 100 na 1ª -> 2ª vem 500+400=900.
  // Paga 200 -> 3ª vem 500+700=1200. Paga 200 -> 4ª (última) = 1500 e, se
  // não paga, fica atrasada mostrando o saldo total.
  // O que vem de trás e precisa ser somado nesta parcela:
  //   a) parcelas NÃO pagas (pending/partial/late) — o valor inteiro que falta;
  //   b) SALDO RESIDUAL de parcelas flexíveis já encerradas — o usuário
  //      cumpriu a obrigação daquele mês, mas ficou um resto acordado.
  // O caso (b) não é atraso e não reabre a parcela: só acompanha a dívida.
  const previousOpen = await client.expense.findMany({
    where: {
      debtId: debt.id,
      deletedAt: null,
      monthId: { not: month.id },
      OR: [
        { status: { in: ['pending', 'partial', 'late'] } },
        { status: 'flex_paid', residualAmount: { gt: 0 } },
      ],
    },
    select: { id: true, value: true, paidAmount: true, status: true, residualAmount: true },
  });

  const arrears = round2(previousOpen.reduce((sum, e) => (
    e.status === 'flex_paid'
      ? sum + Number(e.residualAmount ?? 0)
      : sum + (Number(e.value) - Number(e.paidAmount ?? 0))
  ), 0));
  for (const prev of previousOpen) {
    if (prev.status === 'flex_paid') continue; // já encerrada; o resíduo só migra
    // Parcela não paga: o que faltava dela passa a estar embutido na parcela
    // ATUAL, então ela é fechada com o valor efetivamente pago. Sem isso, a
    // mesma dívida apareceria nos dois meses.
    await client.expense.update({
      where: { id: prev.id },
      data: { status: 'paid', value: round2(Number(prev.paidAmount ?? 0)) },
    });
  }

  const nominal = Number(debt.installmentValue);
  const isLast = !isExtra && plannedRemaining === 1;
  // Última parcela do plano fecha TODO o saldo restante. As demais — e as
  // EXTRAS — cobram nominal + atrasado, limitado ao saldo devedor: é a mesma
  // acumulação que já acontece no pagamento parcial.
  let value = isLast
    ? round2(remainingBalance)
    : round2(Math.min(nominal + arrears, remainingBalance));
  if (value <= 0) value = round2(Math.min(nominal, remainingBalance));

  // Cada parcela extra estende o plano, para o rótulo "n/total" seguir
  // coerente (uma dívida de 4x que precisou de mais uma vira 5/5).
  const totalLabel = isExtra ? installmentsGenerated + 1 : debt.installmentsCount;

  await client.debt.update({
    where: { id: debt.id },
    data: {
      pendingCarryOver: 0,
      ...(isExtra ? { installmentsCount: totalLabel } : {}),
    },
  });

  const dueDate = expensesService.dueDateFromDay(month, debt.dueDay);
  const created = await client.expense.create({
    data: {
      userId: debt.userId,
      monthId: month.id,
      type: 'priority',
      description: `${debt.description} (${installmentsGenerated + 1}/${totalLabel}${isExtra ? ' · parcela extra' : ''})`,
      categoryId: debt.categoryId,
      dueDate,
      value,
      status: dueDate < todayUtcDate() ? 'late' : 'pending',
      debtId: debt.id,
    },
  });

  // Registra para onde cada saldo residual foi. É o que permite, ao quitar o
  // resíduo depois, reduzir o acréscimo desta parcela — sem cobrar duas vezes.
  const carriedIds = previousOpen.filter((e) => e.status === 'flex_paid').map((e) => e.id);
  if (carriedIds.length > 0) {
    await client.expense.updateMany({
      where: { id: { in: carriedIds } },
      data: { carriedToExpenseId: created.id },
    });
  }

  return created;
}

/**
 * RENEGOCIAÇÃO: reparcelar o saldo devedor restante em N novos meses.
 *
 * Usada quando a última parcela ficou com o saldo acumulado e o usuário
 * quer voltar a dividir. Substitui a parcela em aberto atual pela primeira
 * parcela do novo plano; as demais são geradas nos próximos fechamentos.
 * Não toca em parcelas já pagas nem em meses fechados.
 */
async function renegotiateDebt(userId, debtId, { installments, monthId }) {
  const debt = await getDebtOrThrow(userId, debtId);
  if (debt.status === 'settled') {
    throw new AppError('Esta dívida já está quitada.', 409, 'DEBT_ALREADY_SETTLED');
  }
  const remaining = Number(debt.remainingBalance);
  if (remaining <= SETTLE_TOLERANCE) {
    throw new AppError('Não há saldo devedor para reparcelar.', 409, 'NOTHING_TO_RENEGOTIATE');
  }

  const month = await monthsService.getMonthOrThrow(userId, monthId);
  monthsService.assertMonthIsOpen(month);

  const newCount = Number(installments);
  const newValue = round2(remaining / newCount);

  return prisma.$transaction(async (tx) => {
    await lockUserBalance(tx, userId);

    // Fecha (soft delete) as parcelas em ABERTO em meses ABERTOS: elas são
    // substituídas pelo novo plano. Parcelas pagas e de meses fechados
    // ficam intactas (histórico).
    const openNow = await tx.expense.findMany({
      where: { debtId, deletedAt: null, status: { in: ['pending', 'partial', 'late'] }, month: { status: 'open' } },
      select: { id: true, paidAmount: true },
    });
    for (const inst of openNow) {
      if (Number(inst.paidAmount ?? 0) > 0) {
        // Parcela com pagamento parcial: NÃO apaga (o saldo conta o
        // paidAmount, apagar devolveria o dinheiro). Fecha reduzindo o
        // valor ao que foi pago; o restante entra no novo parcelamento.
        await tx.expense.update({
          where: { id: inst.id },
          data: { value: round2(Number(inst.paidAmount)), status: 'paid', deletedAt: null },
        });
      } else {
        await tx.expense.update({ where: { id: inst.id }, data: { deletedAt: new Date() } });
      }
    }

    const paidInstallments = await tx.expense.count({
      where: { debtId, deletedAt: null },
    });

    // A dívida passa a ter (parcelas já registradas + novas) e valor de
    // parcela = saldo / N.
    await tx.debt.update({
      where: { id: debtId },
      data: {
        installmentValue: newValue,
        installmentsCount: paidInstallments + newCount,
        pendingCarryOver: 0,
        status: 'active',
      },
    });

    // Cria já a primeira parcela do novo plano no mês selecionado.
    const dueDate = expensesService.dueDateFromDay(month, debt.dueDay);
    const firstValue = computeInstallmentValue(remaining, newCount, newValue);
    const created = await tx.expense.create({
      data: {
        userId,
        monthId: month.id,
        type: 'priority',
        description: `${debt.description} (${paidInstallments + 1}/${paidInstallments + newCount})`,
        categoryId: debt.categoryId,
        dueDate,
        value: firstValue,
        status: dueDate < todayUtcDate() ? 'late' : 'pending',
        debtId,
      },
      include: { category: true },
    });

    return { debtId: String(debtId), installments: newCount, installmentValue: newValue, firstInstallment: created };
  }).then(async (res) => {
    await recordAuditLog(userId, 'debt', debtId, 'renegotiate', {
      newValue: { installments: newCount, installmentValue: newValue },
    });
    return res;
  });
}

/**
 * Indicadores reais de dívida para o Dashboard. Antes, a tela contava
 * "parcelas restantes" a partir da lista truncada de próximos vencimentos
 * (LIMIT 5), o que produzia o absurdo "Dívida ativa R$ X — 0 parcelas".
 * Aqui os números vêm do saldo devedor e das parcelas de fato existentes.
 */
async function getDebtIndicators(userId, client = prisma) {
  const debts = await client.debt.findMany({
    where: { userId, status: 'active' },
    select: {
      id: true, description: true, remainingBalance: true,
      installmentValue: true, installmentsCount: true, dueDay: true,
    },
  });

  const activeDebts = debts.filter((debt) => Number(debt.remainingBalance) > SETTLE_TOLERANCE);
  if (activeDebts.length === 0) {
    return {
      activeDebtsCount: 0,
      totalRemainingBalance: 0,
      remainingInstallments: 0,
      nextInstallment: null,
    };
  }

  // Uma única query para todas as dívidas (evita N+1 por dívida).
  const nextInstallments = await client.expense.findMany({
    where: {
      userId,
      debtId: { in: activeDebts.map((debt) => debt.id) },
      deletedAt: null,
      status: { in: ['pending', 'partial', 'late'] },
    },
    select: { value: true, dueDate: true, description: true, debtId: true },
    orderBy: { dueDate: 'asc' },
    take: 1,
  });

  const next = nextInstallments[0] ?? null;
  return {
    activeDebtsCount: activeDebts.length,
    totalRemainingBalance: round2(
      activeDebts.reduce((sum, debt) => sum + Number(debt.remainingBalance), 0)
    ),
    remainingInstallments: activeDebts.reduce(
      (sum, debt) => sum + remainingInstallmentsFor(debt), 0
    ),
    nextInstallment: next
      ? { description: next.description, value: round2(Number(next.value)), dueDate: next.dueDate }
      : null,
  };
}

module.exports = {
  createDebt,
  listDebts,
  getDebtOrThrow,
  updateDebt,
  deleteDebt,
  applyPaymentToInstallment,
  generateNextInstallment,
  computeInstallmentValue,
  getDebtIndicators,
  remainingInstallmentsFor,
  renegotiateDebt,
  SETTLE_TOLERANCE,
};