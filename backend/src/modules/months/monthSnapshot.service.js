const prisma = require('../../config/prisma');
const AppError = require('../../utils/AppError');
const { monthDateRange } = require('../../utils/dateTime');
const { round2 } = require('../../utils/math');
const { getBalanceAsOf } = require('../_shared/balance');

const SNAPSHOT_VERSION = 1;
const SNAPSHOT_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 };

function createdBeforeFilter(recordedBefore) {
  return recordedBefore ? { createdAt: { lte: recordedBefore } } : {};
}

function updatedBeforeFilter(recordedBefore) {
  return recordedBefore ? { updatedAt: { lte: recordedBefore } } : {};
}

function isPendingAtSnapshot(expense, recordedBefore) {
  if (recordedBefore && expense.updatedAt > recordedBefore) return true;
  return ['pending', 'partial', 'late'].includes(expense.status);
}

async function getSavingsBalanceAt(userId, client, recordedBefore) {
  const createdFilter = createdBeforeFilter(recordedBefore);
  const [deposits, withdrawals] = await Promise.all([
    client.savingsTransaction.aggregate({
      where: { userId, type: 'deposit', ...createdFilter },
      _sum: { value: true },
    }),
    client.savingsTransaction.aggregate({
      where: { userId, type: 'withdraw', ...createdFilter },
      _sum: { value: true },
    }),
  ]);
  return round2(Number(deposits._sum.value ?? 0) - Number(withdrawals._sum.value ?? 0));
}

async function getDebtBalanceAt(userId, client, recordedBefore) {
  if (!recordedBefore) {
    const aggregate = await client.debt.aggregate({
      where: { userId, status: 'active' },
      _sum: { remainingBalance: true },
    });
    return round2(Number(aggregate._sum.remainingBalance ?? 0));
  }

  const debts = await client.debt.findMany({
    where: { userId, createdAt: { lte: recordedBefore } },
    select: { id: true, totalValue: true },
  });
  if (debts.length === 0) return 0;

  const payments = await client.expense.groupBy({
    by: ['debtId'],
    where: {
      userId,
      debtId: { in: debts.map((debt) => debt.id) },
      deletedAt: null,
      updatedAt: { lte: recordedBefore },
      paidAmount: { gt: 0 },
    },
    _sum: { paidAmount: true },
  });
  const paidByDebt = new Map(payments.map((row) => [String(row.debtId), Number(row._sum.paidAmount ?? 0)]));
  return round2(debts.reduce(
    (sum, debt) => sum + Math.max(Number(debt.totalValue) - (paidByDebt.get(String(debt.id)) ?? 0), 0),
    0
  ));
}

/**
 * Cria um retrato financeiro imutável de um mês.
 *
 * `recordedBefore` é usado apenas para reconstruir meses que já estavam
 * fechados antes da migration. Nesse modo, lançamentos criados/alterados após
 * `closedAt` são ignorados, mesmo quando receberam uma data contábil antiga.
 */
async function buildMonthSnapshot(userId, month, client = prisma, {
  recordedBefore = null,
  reconstructed = false,
} = {}) {
  const { start, end } = monthDateRange(Number(month.year), Number(month.month));
  const dayBeforeStart = new Date(start.getTime() - 1);
  const incomeRecordedFilter = createdBeforeFilter(recordedBefore);
  const expenseRecordedFilter = createdBeforeFilter(recordedBefore);
  const paidRecordedFilter = updatedBeforeFilter(recordedBefore);
  const contributionRecordedFilter = createdBeforeFilter(recordedBefore);
  const savingsRecordedFilter = createdBeforeFilter(recordedBefore);

  const [
    incomesAgg,
    monthExpenses,
    paidAgg,
    goalMovements,
    cashIncomesAgg,
    cashExpensesPaidAgg,
    digitalIncomesAgg,
    digitalExpensesPaidAgg,
    openingBalance,
    closingBalance,
    savingsBalance,
    totalActiveDebt,
  ] = await Promise.all([
    client.income.aggregate({
      where: { userId, monthId: month.id, ...incomeRecordedFilter },
      _sum: { value: true },
    }),
    client.expense.findMany({
      where: { userId, monthId: month.id, deletedAt: null, ...expenseRecordedFilter },
      select: { value: true, paidAmount: true, status: true, updatedAt: true },
    }),
    client.expense.aggregate({
      where: {
        userId,
        deletedAt: null,
        paidAt: { gte: start, lte: end },
        ...paidRecordedFilter,
      },
      _sum: { paidAmount: true },
    }),
    client.goalContribution.findMany({
      where: { monthId: month.id, goal: { userId }, ...contributionRecordedFilter },
      select: { type: true, value: true },
    }),
    client.income.aggregate({
      where: { userId, monthId: month.id, origin: 'physical', ...incomeRecordedFilter },
      _sum: { value: true },
    }),
    client.expense.aggregate({
      where: {
        userId,
        paymentMethod: 'cash',
        deletedAt: null,
        paidAt: { gte: start, lte: end },
        ...paidRecordedFilter,
      },
      _sum: { paidAmount: true },
    }),
    client.income.aggregate({
      where: { userId, monthId: month.id, origin: 'digital', ...incomeRecordedFilter },
      _sum: { value: true },
    }),
    client.expense.aggregate({
      where: {
        userId,
        paymentMethod: { not: 'cash' },
        deletedAt: null,
        paidAt: { gte: start, lte: end },
        ...paidRecordedFilter,
      },
      _sum: { paidAmount: true },
    }),
    getBalanceAsOf(userId, dayBeforeStart, client, recordedBefore),
    getBalanceAsOf(userId, end, client, recordedBefore),
    getSavingsBalanceAt(userId, client, recordedBefore),
    getDebtBalanceAt(userId, client, recordedBefore),
  ]);

  const incomeTotal = Number(incomesAgg._sum.value ?? 0);
  const expensesPlanned = round2(monthExpenses.reduce((sum, expense) => sum + Number(expense.value), 0));
  const expensesPaid = Number(paidAgg._sum.paidAmount ?? 0);
  const outstanding = round2(monthExpenses.reduce((sum, expense) => {
    if (!isPendingAtSnapshot(expense, recordedBefore)) return sum;
    const paidAtSnapshot = recordedBefore && expense.updatedAt > recordedBefore ? 0 : Number(expense.paidAmount ?? 0);
    return sum + Math.max(Number(expense.value) - paidAtSnapshot, 0);
  }, 0));
  const pendingExpensesCount = monthExpenses.filter((expense) => isPendingAtSnapshot(expense, recordedBefore)).length;
  const goalNet = round2(goalMovements.reduce(
    (sum, item) => sum + (item.type === 'contribution' ? Number(item.value) : -Number(item.value)),
    0
  ));

  const [savingsDeposits, savingsWithdrawals] = await Promise.all([
    client.savingsTransaction.aggregate({
      where: {
        userId,
        type: 'deposit',
        origin: 'balance',
        transactionDate: { gte: start, lte: end },
        ...savingsRecordedFilter,
      },
      _sum: { value: true },
    }),
    client.savingsTransaction.aggregate({
      where: {
        userId,
        type: 'withdraw',
        transactionDate: { gte: start, lte: end },
        ...savingsRecordedFilter,
      },
      _sum: { value: true },
    }),
  ]);
  const savingsNet = round2(
    Number(savingsDeposits._sum.value ?? 0) - Number(savingsWithdrawals._sum.value ?? 0)
  );

  return {
    version: SNAPSHOT_VERSION,
    capturedAt: new Date().toISOString(),
    reconstructed: Boolean(reconstructed),
    sourceClosedAt: month.closedAt ? new Date(month.closedAt).toISOString() : null,
    openingBalance: round2(openingBalance),
    incomeTotal: round2(incomeTotal),
    expensesPlanned,
    expensesPaid: round2(expensesPaid),
    outstanding,
    currentBalance: round2(closingBalance),
    projectedBalance: round2(closingBalance - outstanding),
    savingsBalance,
    savingsNet,
    goalNet,
    physicalCash: round2(Number(cashIncomesAgg._sum.value ?? 0) - Number(cashExpensesPaidAgg._sum.paidAmount ?? 0)),
    digitalCash: round2(Number(digitalIncomesAgg._sum.value ?? 0) - Number(digitalExpensesPaidAgg._sum.paidAmount ?? 0)),
    totalActiveDebt,
    pendingExpensesCount,
  };
}

/**
 * Um snapshot é VÁLIDO PARA LEITURA sempre que existir e tiver uma versão
 * conhecida (<= versão atual). Ele não deixa de valer só porque o produto
 * evoluiu de versão: um mês fechado em 2026 continua sendo o retrato
 * correto daquele mês. Trocar isso por "só a versão mais nova vale" foi o
 * que criava o risco de sobrescrever histórico correto em massa.
 */
function validSnapshot(month) {
  const version = Number(month?.snapshotVersion);
  return Boolean(month?.financialSnapshot) && Number.isFinite(version) && version >= 1 && version <= SNAPSHOT_VERSION;
}

/** Snapshot existe, mas foi gravado por uma versão anterior do formato. */
function isStaleSnapshot(month) {
  return validSnapshot(month) && Number(month.snapshotVersion) < SNAPSHOT_VERSION;
}

/** Arquiva a versão atual antes de qualquer substituição. */
async function archiveSnapshot(tx, monthId, snapshot, version, reason) {
  if (!snapshot) return;
  await tx.monthSnapshotVersion.create({
    data: {
      monthId,
      version: Number(version) || 1,
      snapshot,
      reason: String(reason).slice(0, 80),
    },
  });
}

/**
 * Garante que um mês fechado tenha snapshot — SEM NUNCA sobrescrever um
 * snapshot já existente.
 *
 * Comportamento anterior: qualquer divergência de versão disparava uma
 * reconstrução que gravava por cima. Como a reconstrução é aproximada (ver
 * `recordedBefore`), subir SNAPSHOT_VERSION teria trocado, de uma só vez,
 * todos os retratos corretos por estimativas — sem registro do que foi
 * perdido. Agora só o caso "mês fechado sem nenhum snapshot" gera escrita,
 * e mesmo esse fica arquivado e marcado como reconstruído.
 */
async function ensureClosedMonthSnapshot(userId, month) {
  if (!month || month.status !== 'closed') return null;
  if (validSnapshot(month)) return month.financialSnapshot;

  return prisma.$transaction(async (tx) => {
    const lockedRows = await tx.$queryRaw`
      SELECT id, user_id, month, year, status, closed_at, created_at,
             financial_snapshot, snapshot_version
      FROM months
      WHERE id = ${month.id} AND user_id = ${userId}
      FOR UPDATE
    `;
    const locked = lockedRows[0];
    if (!locked || locked.status !== 'closed') return null;

    // Releitura sob lock: outra requisição pode ter criado o snapshot.
    if (locked.financial_snapshot) return locked.financial_snapshot;

    const monthForSnapshot = {
      id: locked.id,
      userId: locked.user_id,
      month: Number(locked.month),
      year: Number(locked.year),
      status: locked.status,
      closedAt: locked.closed_at,
      createdAt: locked.created_at,
    };
    const cutoff = locked.closed_at || locked.created_at || new Date();
    const snapshot = await buildMonthSnapshot(userId, monthForSnapshot, tx, {
      recordedBefore: cutoff,
      reconstructed: true,
    });
    await tx.month.update({
      where: { id: locked.id },
      data: { financialSnapshot: snapshot, snapshotVersion: SNAPSHOT_VERSION },
    });
    await archiveSnapshot(tx, locked.id, snapshot, SNAPSHOT_VERSION, 'missing_snapshot_reconstruction');
    return snapshot;
  }, SNAPSHOT_TRANSACTION_OPTIONS);
}

/**
 * Migração CONTROLADA de um snapshot antigo. Só roda quando chamada
 * explicitamente (nunca por leitura de tela), arquiva a versão anterior e
 * registra o motivo. É o caminho seguro para, no futuro, subir
 * SNAPSHOT_VERSION sem perder os retratos originais.
 */
async function rebuildClosedMonthSnapshot(userId, monthId, reason = 'manual_rebuild') {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`
      SELECT id, user_id, month, year, status, closed_at, created_at,
             financial_snapshot, snapshot_version
      FROM months
      WHERE id = ${monthId} AND user_id = ${userId}
      FOR UPDATE
    `;
    const locked = rows[0];
    if (!locked) throw new AppError('Mês não encontrado.', 404, 'MONTH_NOT_FOUND');
    if (locked.status !== 'closed') {
      throw new AppError('Só meses encerrados possuem retrato financeiro.', 409, 'MONTH_NOT_CLOSED');
    }

    await archiveSnapshot(tx, locked.id, locked.financial_snapshot, locked.snapshot_version, reason);

    const cutoff = locked.closed_at || locked.created_at || new Date();
    const snapshot = await buildMonthSnapshot(userId, {
      id: locked.id,
      userId: locked.user_id,
      month: Number(locked.month),
      year: Number(locked.year),
      status: locked.status,
      closedAt: locked.closed_at,
      createdAt: locked.created_at,
    }, tx, { recordedBefore: cutoff, reconstructed: true });

    await tx.month.update({
      where: { id: locked.id },
      data: { financialSnapshot: snapshot, snapshotVersion: SNAPSHOT_VERSION },
    });
    await archiveSnapshot(tx, locked.id, snapshot, SNAPSHOT_VERSION, `${reason}:result`);
    return snapshot;
  }, SNAPSHOT_TRANSACTION_OPTIONS);
}

module.exports = {
  SNAPSHOT_VERSION,
  buildMonthSnapshot,
  ensureClosedMonthSnapshot,
  rebuildClosedMonthSnapshot,
  validSnapshot,
  isStaleSnapshot,
};
