const prisma = require('../../config/prisma');
const AppError = require('../../utils/AppError');
const { round2 } = require('../../utils/math');

async function getBalanceComponents(userId, client = prisma, asOf = null, recordedBefore = null) {
  const dateFilter = asOf ? { lte: asOf } : undefined;
  const incomeRecordedFilter = recordedBefore ? { createdAt: { lte: recordedBefore } } : {};
  const expenseRecordedFilter = recordedBefore ? { updatedAt: { lte: recordedBefore } } : {};
  const contributionRecordedFilter = recordedBefore ? { createdAt: { lte: recordedBefore } } : {};
  const savingsRecordedFilter = recordedBefore ? { createdAt: { lte: recordedBefore } } : {};

  const [incomeAgg, expenseAgg, goalContributions, goalRefunds, savingsDeposits, savingsWithdrawals] = await Promise.all([
    client.income.aggregate({
      where: { userId, ...(dateFilter ? { incomeDate: dateFilter } : {}), ...incomeRecordedFilter },
      _sum: { value: true },
    }),
    client.expense.aggregate({
      where: {
        userId,
        deletedAt: null,
        ...(dateFilter ? { paidAt: dateFilter } : {}),
        ...expenseRecordedFilter,
      },
      _sum: { paidAmount: true },
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
    income: Number(incomeAgg._sum.value ?? 0),
    paidExpenses: Number(expenseAgg._sum.paidAmount ?? 0),
    goalContributions: Number(goalContributions._sum.value ?? 0),
    goalRefunds: Number(goalRefunds._sum.value ?? 0),
    savingsDepositsFromBalance: Number(savingsDeposits._sum.value ?? 0),
    savingsWithdrawals: Number(savingsWithdrawals._sum.value ?? 0),
  };
}

function calculateBalance(components) {
  return round2(
    components.income
      - components.paidExpenses
      - components.goalContributions
      + components.goalRefunds
      - components.savingsDepositsFromBalance
      + components.savingsWithdrawals
  );
}

/**
 * Saldo livre acumulado de todos os meses. O valor nunca é reiniciado na
 * virada do mês: toda entrada e saída real participa do mesmo caixa.
 */
async function getAvailableBalance(userId, client = prisma) {
  // A data dos lançamentos é referência contábil/relatório. Quando uma
  // operação real é salva, seu efeito no caixa é imediato. Por isso o saldo
  // disponível considera todos os lançamentos já persistidos, inclusive uma
  // receita recorrente gerada para o próximo mês.
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

/** Serializa todas as operações que podem consumir o saldo do mesmo usuário. */
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
