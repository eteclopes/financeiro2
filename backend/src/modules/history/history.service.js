const prisma = require('../../config/prisma');
const monthsService = require('../months/months.service');
const { getAllMonthsChronological } = require('../_shared/financialMetrics');
const { getBalanceAsOf } = require('../_shared/balance');
const { monthDateRange } = require('../../utils/dateTime');
const { round2 } = require('../../utils/math');

const PERIODS = { 3: 3, 6: 6, 12: 12 };

async function getSavingsBalanceAsOf(userId, date) {
  const [deposits, withdrawals] = await Promise.all([
    prisma.savingsTransaction.aggregate({
      where: { userId, type: 'deposit', transactionDate: { lte: date } },
      _sum: { value: true },
    }),
    prisma.savingsTransaction.aggregate({
      where: { userId, type: 'withdraw', transactionDate: { lte: date } },
      _sum: { value: true },
    }),
  ]);
  return round2(Number(deposits._sum.value ?? 0) - Number(withdrawals._sum.value ?? 0));
}

async function getFinancialHistory(userId, monthId, periodMonths = 6) {
  await monthsService.getMonthOrThrow(userId, monthId);
  const clampedPeriod = PERIODS[periodMonths] ?? 6;

  const allMonths = await getAllMonthsChronological(userId);
  const idx = allMonths.findIndex((month) => String(month.id) === String(monthId));
  const slice = allMonths.slice(Math.max(0, idx - clampedPeriod + 1), idx + 1);

  if (slice.length === 0) return { periods: 0, months: [] };

  const monthsData = await Promise.all(slice.map(async (month) => {
    const { start, end } = monthDateRange(month.year, month.month);
    const beforeStart = new Date(start.getTime() - 1);

    const [incomeAgg, expensesAgg, paidAgg, healthScore, openingBalance, closingBalance, savingsBalance] = await Promise.all([
      prisma.income.aggregate({ where: { userId, monthId: month.id }, _sum: { value: true } }),
      prisma.expense.aggregate({ where: { userId, monthId: month.id, deletedAt: null }, _sum: { value: true } }),
      prisma.expense.aggregate({
        where: { userId, deletedAt: null, paidAt: { gte: start, lte: end } },
        _sum: { paidAmount: true },
      }),
      prisma.financialHealthScore.findFirst({ where: { userId, monthId: month.id } }),
      getBalanceAsOf(userId, beforeStart),
      getBalanceAsOf(userId, end),
      getSavingsBalanceAsOf(userId, end),
    ]);

    return {
      month: month.month,
      year: month.year,
      status: month.status,
      income: round2(Number(incomeAgg._sum.value ?? 0)),
      plannedExpenses: round2(Number(expensesAgg._sum.value ?? 0)),
      paidExpenses: round2(Number(paidAgg._sum.paidAmount ?? 0)),
      openingBalance: round2(openingBalance),
      netBalance: round2(closingBalance - openingBalance),
      cumulativeBalance: round2(closingBalance),
      savingsBalance,
      healthScore: healthScore?.score ?? null,
    };
  }));

  const debtByMonth = await Promise.all(slice.map(async (month) => {
    const agg = await prisma.expense.aggregate({
      where: { userId, monthId: month.id, type: 'priority', deletedAt: null },
      _sum: { value: true },
    });
    return round2(Number(agg._sum.value ?? 0));
  }));

  const enriched = monthsData.map((month, index) => ({ ...month, debtInstallments: debtByMonth[index] }));
  return {
    periods: slice.length,
    requestedPeriod: clampedPeriod,
    months: enriched,
    summary: buildSummary(enriched),
  };
}

function buildSummary(months) {
  if (months.length === 0) return {};
  const incomes = months.map((month) => month.income);
  const expenses = months.map((month) => month.paidExpenses);
  const avg = (values) => round2(values.reduce((sum, value) => sum + value, 0) / values.length);
  return {
    avgIncome: avg(incomes),
    avgExpenses: avg(expenses),
    bestMonthNet: months.reduce((best, month) => month.netBalance > (best?.netBalance ?? -Infinity) ? month : best, null),
    worstMonthNet: months.reduce((worst, month) => month.netBalance < (worst?.netBalance ?? Infinity) ? month : worst, null),
    totalNetBalance: round2(months.reduce((sum, month) => sum + month.netBalance, 0)),
    endingBalance: months.at(-1)?.cumulativeBalance ?? 0,
  };
}

module.exports = { getFinancialHistory, getSavingsBalanceAsOf, buildSummary };
