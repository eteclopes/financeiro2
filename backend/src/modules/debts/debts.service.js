const prisma = require('../../config/prisma');
const AppError = require('../../utils/AppError');
const monthsService = require('../months/months.service');
const expensesService = require('../expenses/expenses.service');
const { recordAuditLog } = require('../auditLog/auditLog.service');
const { round2 } = require('../../utils/math');
const { assertSufficientBalance, lockUserBalance } = require('../_shared/balance');
const { todayUtcDate } = require('../../utils/dateTime');

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
      installmentsRemaining: Math.max(debt.installmentsCount - installmentsGenerated, 0),
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

    await assertSufficientBalance(userId, amount, tx);

    const newRemainingBalance = round2(Math.max(Number(debt.remainingBalance) - amount, 0));
    const isSettled = newRemainingBalance <= 0.009;
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

  const installmentsGenerated = options.installmentsGenerated ?? await client.expense.count({ where: { debtId: debt.id } });
  const installmentsRemaining = debt.installmentsCount - installmentsGenerated;
  if (installmentsRemaining <= 0 || Number(debt.remainingBalance) <= 0.009) {
    await client.debt.update({ where: { id: debt.id }, data: { status: 'settled', pendingCarryOver: 0 } });
    return null;
  }

  const carryOver = Number(debt.pendingCarryOver ?? 0);
  const value = computeInstallmentValue(
    debt.remainingBalance,
    installmentsRemaining,
    Number(debt.installmentValue),
    carryOver
  );

  // Se o ajuste pendente não coube inteiro nesta parcela (ex.: um
  // excedente maior que o valor nominal, ou perto do fim da dívida, onde o
  // saldo já é curto), a sobra continua valendo para a parcela seguinte —
  // em vez de ser descartada. Na imensa maioria dos casos isso dá zero
  // (o ajuste é aplicado por inteiro nesta única parcela).
  const remainingCarryOver = round2((Number(debt.installmentValue) + carryOver) - value);
  await client.debt.update({ where: { id: debt.id }, data: { pendingCarryOver: remainingCarryOver } });

  return client.expense.create({
    data: {
      userId: debt.userId,
      monthId: month.id,
      type: 'priority',
      description: `${debt.description} (${installmentsGenerated + 1}/${debt.installmentsCount})`,
      categoryId: debt.categoryId,
      dueDate: expensesService.dueDateFromDay(month, debt.dueDay),
      value,
      status: 'pending',
      debtId: debt.id,
    },
  });
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
};