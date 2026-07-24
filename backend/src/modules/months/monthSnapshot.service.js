const prisma = require('../../config/prisma');
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

function validSnapshot(month) {
  return month?.financialSnapshot && Number(month.snapshotVersion) === SNAPSHOT_VERSION;
}

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
    if (locked.financial_snapshot && Number(locked.snapshot_version) === SNAPSHOT_VERSION) {
      return locked.financial_snapshot;
    }

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
    return snapshot;
  }, SNAPSHOT_TRANSACTION_OPTIONS);
}

module.exports = {
  SNAPSHOT_VERSION,
  buildMonthSnapshot,
  ensureClosedMonthSnapshot,
  validSnapshot,
};
