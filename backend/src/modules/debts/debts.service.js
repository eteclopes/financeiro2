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
    await tx.expense.deleteMany({
      where: {
        debtId,
        status: { in: ['pending', 'late'] },
        paidAmount: 0,
        month: { status: 'open' },
      },
    });

    return tx.debt.update({ where: { id: debtId }, data: { status: 'settled' } });
  }).then(async (updated) => {
    await recordAuditLog(userId, 'debt', debtId, 'delete', { oldValue: debt, newValue: updated });
    return updated;
  });
}

/**
 * Núcleo da Etapa 10 (pagamento flexível) e da regra de excedente.
 * Chamado por expenses.service.payExpense quando expense.type === 'priority'.
 *
 * Pagar mais ou menos que o valor da parcela não fica "perdido" até a
 * parcela final — ajusta diretamente a PRÓXIMA parcela a gerar, via
 * `pendingCarryOver` (excesso paga a menos na próxima; falta paga a mais
 * na próxima). Uma vez que esta parcela recebe QUALQUER pagamento (mesmo
 * parcial), ela está encerrada — não é possível "completá-la" depois com
 * um segundo pagamento, porque o ajuste da diferença já foi propagado
 * para a parcela seguinte; um segundo pagamento aqui contaria a mesma
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
    if (['partial', 'paid', 'settled'].includes(currentExpense.status)) {
      throw new AppError(
        'Esta parcela já recebeu um pagamento — o ajuste já foi aplicado à próxima parcela.',
        409,
        'INSTALLMENT_ALREADY_SETTLED'
      );
    }

    const debt = await getDebtOrThrow(userId, currentExpense.debtId, tx);
    const installmentValue = Number(currentExpense.value);
    const isShortfall = amount < installmentValue - 0.009;
    if (isShortfall && !debt.flexiblePayment) {
      throw new AppError(
        'Esta dívida exige pagamento exato da parcela (pagamento flexível desativado).',
        422,
        'EXACT_PAYMENT_REQUIRED'
      );
    }

    // Pagar acima do saldo devedor apagaria dinheiro silenciosamente: o
    // excedente sumiria do sistema sem virar saldo nem reduzir outra dívida.
    const remainingBalance = Number(debt.remainingBalance);
    if (amount > remainingBalance + SETTLE_TOLERANCE) {
      throw new AppError(
        `O valor informado é maior que o saldo devedor desta dívida (R$ ${remainingBalance.toFixed(2)}). Para quitar, pague exatamente o saldo devedor.`,
        422,
        'PAYMENT_ABOVE_DEBT_BALANCE',
        { remainingBalance: round2(remainingBalance), requestedAmount: round2(amount) }
      );
    }

    await assertSufficientBalance(userId, amount, tx);

    const newRemainingBalance = round2(Math.max(remainingBalance - amount, 0));
    const isSettled = newRemainingBalance <= SETTLE_TOLERANCE;
    const newExpenseStatus = amount >= installmentValue - 0.009 ? 'paid' : 'partial';
    const delta = round2(amount - installmentValue);
    const newCarryOver = isSettled ? 0 : round2(Number(debt.pendingCarryOver) - delta);

    const updatedExpense = await tx.expense.update({
      where: { id: currentExpense.id },
      data: {
        paidAmount: amount,
        paidAt: todayUtcDate(),
        status: isSettled ? 'paid' : newExpenseStatus,
        paymentMethod,
      },
      include: { category: true },
    });

    const updatedDebt = await tx.debt.update({
      where: { id: debt.id },
      data: {
        remainingBalance: newRemainingBalance,
        pendingCarryOver: newCarryOver,
        status: isSettled ? 'settled' : 'active',
      },
    });

    return { expense: updatedExpense, debt: updatedDebt };
  });
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

  // QUITAÇÃO REAL: a única condição para encerrar uma dívida é o saldo
  // devedor chegar a zero. Antes, esgotar as parcelas originalmente
  // planejadas também encerrava a dívida — e o saldo restante era apagado
  // do sistema (o usuário deixava de ver que ainda devia).
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
  const carryOver = Number(debt.pendingCarryOver ?? 0);

  // O plano original acabou mas ainda há saldo devedor (típico de pagamento
  // flexível com parcelas menores). Em vez de apagar o resto, a dívida ganha
  // uma parcela RESIDUAL e o total de parcelas é estendido — assim o rótulo
  // "(n/total)" continua coerente e a dívida some do total ativo apenas
  // quando for realmente paga.
  const isResidual = plannedRemaining <= 0;
  const nominal = Number(debt.installmentValue);

  let value;
  if (isResidual) {
    const target = nominal + carryOver;
    value = round2(Math.min(target > 0 ? target : remainingBalance, remainingBalance));
    if (value <= 0) value = round2(remainingBalance);
  } else {
    value = computeInstallmentValue(remainingBalance, plannedRemaining, nominal, carryOver);
  }

  // Sobra do ajuste que não coube nesta parcela continua valendo para a
  // seguinte, em vez de ser descartada.
  const remainingCarryOver = isResidual ? 0 : round2((nominal + carryOver) - value);

  await client.debt.update({
    where: { id: debt.id },
    data: {
      pendingCarryOver: remainingCarryOver,
      ...(isResidual ? { installmentsCount: debt.installmentsCount + 1 } : {}),
    },
  });

  const totalLabel = isResidual ? debt.installmentsCount + 1 : debt.installmentsCount;

  return client.expense.create({
    data: {
      userId: debt.userId,
      monthId: month.id,
      type: 'priority',
      description: `${debt.description} (${installmentsGenerated + 1}/${totalLabel})`,
      categoryId: debt.categoryId,
      dueDate: expensesService.dueDateFromDay(month, debt.dueDay),
      value,
      status: 'pending',
      debtId: debt.id,
    },
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
  SETTLE_TOLERANCE,
};