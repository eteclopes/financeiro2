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
const { ensureClosedMonthSnapshot } = require('../months/monthSnapshot.service');

async function getDashboard(userId, monthId) {
  const [month, planInfo] = await Promise.all([
    monthsService.getMonthOrThrow(userId, monthId),
    getUserPlan(userId),
  ]);
  const { entitlements } = planInfo;
  const closedSnapshot = month.status === 'closed'
    ? await ensureClosedMonthSnapshot(userId, month)
    : null;
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
    prisma.goalContribution.findMany({ where: { monthId, goal: { userId } } }),
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

  const liveSummary = {
    openingBalance: round2(openingBalance),
    incomeTotal: round2(incomeTotal),
    expensesPlanned: round2(expensesPlanned),
    expensesPaid: round2(expensesPaid),
    currentBalance: round2(currentBalance),
    projectedBalance: round2(monthEndBalance - outstanding),
    savingsBalance: round2(Number(savingsBalance ?? 0)),
    savingsNet: round2(savingsNet),
    goalNet: round2(goalNet),
    physicalCash: round2(physicalCash),
    digitalCash: round2(digitalCash),
    totalActiveDebt: round2(Number(debtsAgg._sum.remainingBalance ?? 0)),
    pendingExpensesCount: pendingCount,
  };
  const summary = closedSnapshot ?? liveSummary;

  const incomeRef = avgIncome > 0
    ? avgIncome
    : Number(summary.incomeTotal) > 0
      ? Number(summary.incomeTotal)
      : 1;
  const commitmentRatio = round2(Number(summary.expensesPlanned) / incomeRef);
  const commitmentBand = classifyCommitment(commitmentRatio);

  return {
    month,
    historicalSnapshot: closedSnapshot ? {
      version: Number(closedSnapshot.version ?? 1),
      capturedAt: closedSnapshot.capturedAt ?? null,
      reconstructed: Boolean(closedSnapshot.reconstructed),
    } : null,
    openingBalance: Number(summary.openingBalance),
    incomeTotal: Number(summary.incomeTotal),
    expensesPlanned: Number(summary.expensesPlanned),
    expensesPaid: Number(summary.expensesPaid),
    currentBalance: Number(summary.currentBalance),
    projectedBalance: Number(summary.projectedBalance),
    savingsBalance: Number(summary.savingsBalance),
    savingsNet: Number(summary.savingsNet),
    goalNet: Number(summary.goalNet),
    physicalCash: Number(summary.physicalCash),
    digitalCash: Number(summary.digitalCash),
    totalActiveDebt: Number(summary.totalActiveDebt),
    pendingExpensesCount: Number(summary.pendingExpensesCount),
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
