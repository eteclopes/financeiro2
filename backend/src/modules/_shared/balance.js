const prisma = require('../../config/prisma');
const AppError = require('../../utils/AppError');
const { round2 } = require('../../utils/math');

async function getSimulationOpeningBalance(userId, client, asOf = null) {
  const workspace = await client.simulationWorkspace.findUnique({
    where: { profileUserId: userId },
    select: { initialBalance: true, startMonth: true, startYear: true },
  });
  if (!workspace) return 0;
  const startsAt = new Date(Date.UTC(Number(workspace.startYear), Number(workspace.startMonth) - 1, 1));
  if (asOf && asOf.getTime() < startsAt.getTime()) return 0;
  return Number(workspace.initialBalance ?? 0);
}

async function getBalanceComponents(userId, client = prisma, asOf = null, recordedBefore = null) {
  const dateFilter = asOf ? { lte: asOf } : undefined;
  const incomeRecordedFilter = recordedBefore ? { createdAt: { lte: recordedBefore } } : {};
  // Estornos são fatos posteriores ao lançamento; ao reconstruir um snapshot,
  // o corte deve considerar quando o estorno foi gravado, não quando a receita
  // original foi criada.
  const incomeReversalRecordedFilter = recordedBefore ? { updatedAt: { lte: recordedBefore } } : {};
  const expenseRecordedFilter = recordedBefore ? { updatedAt: { lte: recordedBefore } } : {};
  const contributionRecordedFilter = recordedBefore ? { createdAt: { lte: recordedBefore } } : {};
  const savingsRecordedFilter = recordedBefore ? { createdAt: { lte: recordedBefore } } : {};

  const [
    openingBalance,
    incomeAgg,
    incomeReversalAgg,
    expenseAgg,
    reversalAgg,
    goalContributions,
    goalRefunds,
    savingsDeposits,
    savingsWithdrawals,
  ] = await Promise.all([
    getSimulationOpeningBalance(userId, client, asOf),
    client.income.aggregate({
      where: {
        userId,
        ...(dateFilter ? { effectiveDate: dateFilter } : {}),
        ...incomeRecordedFilter,
      },
      _sum: { value: true },
    }),
    client.income.aggregate({
      where: {
        userId,
        reversedAmount: { gt: 0 },
        ...(dateFilter ? { reversedAt: dateFilter } : {}),
        ...incomeReversalRecordedFilter,
      },
      _sum: { reversedAmount: true },
    }),
    client.expense.aggregate({
      where: {
        userId,
        deletedAt: null,
        paidAmount: { gt: 0 },
        ...(dateFilter ? { paidAt: dateFilter } : {}),
        ...expenseRecordedFilter,
      },
      _sum: { paidAmount: true },
    }),
    client.expense.aggregate({
      where: {
        userId,
        reversedAmount: { gt: 0 },
        ...(dateFilter ? { reversedAt: dateFilter } : {}),
        ...expenseRecordedFilter,
      },
      _sum: { reversedAmount: true },
    }),
    client.goalContribution.aggregate({
      where: {
        goal: { userId },
        type: 'contribution',
        ...(dateFilter ? { contributionDate: dateFilter } : {}),
        ...contributionRecordedFilter,
      },
      _sum: { value: true },
    }),
    client.goalContribution.aggregate({
      where: {
        goal: { userId },
        type: 'refund',
        ...(dateFilter ? { contributionDate: dateFilter } : {}),
        ...contributionRecordedFilter,
      },
      _sum: { value: true },
    }),
    client.savingsTransaction.aggregate({
      where: {
        userId,
        type: 'deposit',
        origin: 'balance',
        ...(dateFilter ? { transactionDate: dateFilter } : {}),
        ...savingsRecordedFilter,
      },
      _sum: { value: true },
    }),
    client.savingsTransaction.aggregate({
      where: {
        userId,
        type: 'withdraw',
        ...(dateFilter ? { transactionDate: dateFilter } : {}),
        ...savingsRecordedFilter,
      },
      _sum: { value: true },
    }),
  ]);

  return {
    openingBalance,
    income: Number(incomeAgg._sum.value ?? 0),
    incomeReversals: Number(incomeReversalAgg._sum.reversedAmount ?? 0),
    paidExpenses: Number(expenseAgg._sum.paidAmount ?? 0),
    expenseReversals: Number(reversalAgg._sum.reversedAmount ?? 0),
    goalContributions: Number(goalContributions._sum.value ?? 0),
    goalRefunds: Number(goalRefunds._sum.value ?? 0),
    savingsDepositsFromBalance: Number(savingsDeposits._sum.value ?? 0),
    savingsWithdrawals: Number(savingsWithdrawals._sum.value ?? 0),
  };
}

function calculateBalance(components) {
  return round2(
    (components.openingBalance || 0)
      + components.income
      - (components.incomeReversals || 0)
      - components.paidExpenses
      + (components.expenseReversals || 0)
      - components.goalContributions
      + components.goalRefunds
      - components.savingsDepositsFromBalance
      + components.savingsWithdrawals
  );
}

async function getAvailableBalance(userId, client = prisma) {
  return calculateBalance(await getBalanceComponents(userId, client));
}

async function getBalanceAsOf(userId, date, client = prisma, recordedBefore = null) {
  return calculateBalance(await getBalanceComponents(userId, client, date, recordedBefore));
}

async function assertSufficientBalance(userId, amount, client = prisma) {
  const available = await getAvailableBalance(userId, client);
  if (round2(amount) > available + 0.009) {
    throw new AppError(
      `Saldo insuficiente para esta operação (disponível: R$ ${available.toFixed(2)}).`,
      422,
      'INSUFFICIENT_BALANCE',
      { availableBalance: available, requestedAmount: round2(amount) }
    );
  }
  return available;
}

async function lockUserBalance(client, userId) {
  await client.$executeRaw`SELECT pg_advisory_xact_lock(${userId})`;
}

module.exports = {
  getAvailableBalance,
  getBalanceAsOf,
  getBalanceComponents,
  calculateBalance,
  assertSufficientBalance,
  lockUserBalance,
};
