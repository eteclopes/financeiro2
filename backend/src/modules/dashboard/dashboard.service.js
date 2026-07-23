const prisma = require('../../config/prisma');
const monthsService = require('../months/months.service');
const cardsService = require('../cards/cards.service');
const goalsService = require('../goals/goals.service');
const savingsService = require('../savings/savings.service');
const financialHealthService = require('../financialHealth/financialHealth.service');
const alertsService = require('../alerts/alerts.service');
const recommendationsService = require('../recommendations/recommendations.service');
const { classifyCommitment } = require('../_shared/commitment');
const { getAverageRecentIncome } = require('../_shared/financialMetrics');
const { getAvailableBalance, getBalanceAsOf } = require('../_shared/balance');
const { monthDateRange, todayUtcDate } = require('../../utils/dateTime');
const { round2 } = require('../../utils/math');
const { getUserPlan } = require('../plans/plans.service');

async function getDashboard(userId, monthId) {
  const [month, planInfo] = await Promise.all([
    monthsService.getMonthOrThrow(userId, monthId),
    getUserPlan(userId),
  ]);
  const { entitlements } = planInfo;
  const { start, end } = monthDateRange(month.year, month.month);
  const dayBeforeStart = new Date(start.getTime() - 1);
  const today = todayUtcDate();
  const actualBalanceCutoff = end < today ? end : today;

  const [
    incomesAgg,
    allExpensesAgg,
    paidAgg,
    outstandingAgg,
    pendingExpenses,
    pendingCount,
    debtsAgg,
    savingsBalance,
    goalMovements,
    cashIncomesAgg,
    cashExpensesPaidAgg,
    digitalIncomesAgg,
    digitalExpensesPaidAgg,
    openingBalance,
    currentBalance,
    monthEndBalance,
  ] = await Promise.all([
    prisma.income.aggregate({ where: { userId, monthId }, _sum: { value: true } }),
    prisma.expense.aggregate({ where: { userId, monthId, deletedAt: null }, _sum: { value: true } }),
    prisma.expense.aggregate({
      where: { userId, deletedAt: null, paidAt: { gte: start, lte: end } },
      _sum: { paidAmount: true },
    }),
    prisma.expense.aggregate({
      where: { userId, monthId, deletedAt: null, status: { in: ['pending', 'partial', 'late'] } },
      _sum: { value: true, paidAmount: true },
    }),
    prisma.expense.findMany({
      where: { userId, monthId, deletedAt: null, status: { in: ['pending', 'partial', 'late'] } },
      include: { category: true, cardInvoice: { include: { card: true } } },
      orderBy: { dueDate: 'asc' },
      take: 5,
    }),
    prisma.expense.count({
      where: { userId, monthId, deletedAt: null, status: { in: ['pending', 'partial', 'late'] } },
    }),
    prisma.debt.aggregate({ where: { userId, status: 'active' }, _sum: { remainingBalance: true } }),
    savingsService.getCurrentBalance(userId),
    prisma.goalContribution.findMany({ where: { monthId } }),
    prisma.income.aggregate({ where: { userId, monthId, origin: 'physical' }, _sum: { value: true } }),
    prisma.expense.aggregate({
      where: { userId, paymentMethod: 'cash', deletedAt: null, paidAt: { gte: start, lte: end } },
      _sum: { paidAmount: true },
    }),
    prisma.income.aggregate({ where: { userId, monthId, origin: 'digital' }, _sum: { value: true } }),
    prisma.expense.aggregate({
      where: { userId, paymentMethod: { not: 'cash' }, deletedAt: null, paidAt: { gte: start, lte: end } },
      _sum: { paidAmount: true },
    }),
    getBalanceAsOf(userId, dayBeforeStart),
    month.status === 'open'
      ? getAvailableBalance(userId)
      : getBalanceAsOf(userId, actualBalanceCutoff),
    getBalanceAsOf(userId, end),
  ]);

  const incomeTotal = Number(incomesAgg._sum.value ?? 0);
  const expensesPlanned = Number(allExpensesAgg._sum.value ?? 0);
  const expensesPaid = Number(paidAgg._sum.paidAmount ?? 0);
  const outstanding = round2(
    Number(outstandingAgg._sum.value ?? 0) - Number(outstandingAgg._sum.paidAmount ?? 0)
  );

  const goalNet = round2(goalMovements.reduce(
    (sum, item) => sum + (item.type === 'contribution' ? Number(item.value) : -Number(item.value)),
    0
  ));
  const savingsNet = await savingsService.getNetMovementInRange(userId, start, end);

  const physicalCash = round2(
    Number(cashIncomesAgg._sum.value ?? 0) - Number(cashExpensesPaidAgg._sum.paidAmount ?? 0)
  );
  const digitalCash = round2(
    Number(digitalIncomesAgg._sum.value ?? 0) - Number(digitalExpensesPaidAgg._sum.paidAmount ?? 0)
  );

  const [cards, goals, financialHealthScore, alerts, recommendations, avgIncome] = await Promise.all([
    cardsService.listCards(userId),
    goalsService.listGoals(userId),
    financialHealthService.getOrComputeHealthScore(userId, monthId),
    alertsService.refreshAlerts(userId, monthId),
    entitlements.isPro
      ? recommendationsService.generateRecommendations(userId, monthId)
      : Promise.resolve({ recommendations: [] }),
    getAverageRecentIncome(userId, monthId, 3),
  ]);

  const incomeRef = avgIncome > 0 ? avgIncome : incomeTotal > 0 ? incomeTotal : 1;
  const commitmentRatio = round2(expensesPlanned / incomeRef);
  const commitmentBand = classifyCommitment(commitmentRatio);

  return {
    month,
    openingBalance: round2(openingBalance),
    incomeTotal: round2(incomeTotal),
    expensesPlanned: round2(expensesPlanned),
    expensesPaid: round2(expensesPaid),
    currentBalance: round2(currentBalance),
    projectedBalance: round2(monthEndBalance - outstanding),
    savingsBalance,
    savingsNet,
    goalNet,
    physicalCash,
    digitalCash,
    totalActiveDebt: round2(Number(debtsAgg._sum.remainingBalance ?? 0)),
    pendingExpensesCount: pendingCount,
    upcomingDueDates: pendingExpenses,
    cards,
    goals: goals.filter((goal) => goal.status === 'active'),
    financialHealthScore,
    alerts,
    recommendations: recommendations.recommendations,
    proAccess: {
      recommendations: entitlements.features.advancedRecommendations,
      projections: entitlements.features.futureProjections,
    },
    commitment: {
      ratio: commitmentRatio,
      band: commitmentBand,
      label: { saudavel: 'Saudável', atencao: 'Atenção', risco: 'Risco', critico: 'Crítico' }[commitmentBand],
    },
  };
}

module.exports = { getDashboard };
