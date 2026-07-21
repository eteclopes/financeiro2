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
const { round2 } = require('../../utils/math');

async function getDashboard(userId, monthId) {
  const month = await monthsService.getMonthOrThrow(userId, monthId);

  const [
    incomesAgg,
    allExpensesAgg,
    paidAgg,
    pendingExpenses,
    pendingCount,
    debtsAgg,
    savingsBalance,
    goalMovements,
    // CORREÇÃO BUG 4: filtrar por monthId para obter saldo físico/digital DO MÊS
    // Em vez de acumular todos os meses, mostramos o fluxo de caixa físico/digital
    // referente apenas ao mês selecionado — consistente com saldo atual/projetado.
    cashIncomesAgg,
    cashExpensesPaidAgg,
    digitalIncomesAgg,
    digitalExpensesPaidAgg,
  ] = await Promise.all([
    prisma.income.aggregate({ where: { userId, monthId }, _sum: { value: true } }),
    prisma.expense.aggregate({ where: { userId, monthId, deletedAt: null }, _sum: { value: true } }),
    prisma.expense.aggregate({ where: { userId, monthId, deletedAt: null }, _sum: { paidAmount: true } }),
    prisma.expense.findMany({
      where: { userId, monthId, deletedAt: null, status: { in: ['pending', 'partial', 'late'] } },
      include: { category: true },
      orderBy: { dueDate: 'asc' },
      take: 5,
    }),
    prisma.expense.count({
      where: { userId, monthId, deletedAt: null, status: { in: ['pending', 'partial', 'late'] } },
    }),
    prisma.debt.aggregate({ where: { userId, status: 'active' }, _sum: { remainingBalance: true } }),
    savingsService.getCurrentBalance(userId),
    prisma.goalContribution.findMany({ where: { monthId } }),
    // Saldo físico = receitas em dinheiro - despesas pagas em dinheiro (no mês)
    prisma.income.aggregate({ where: { userId, monthId, paymentMethod: 'cash' }, _sum: { value: true } }),
    prisma.expense.aggregate({ where: { userId, monthId, paymentMethod: 'cash', deletedAt: null }, _sum: { paidAmount: true } }),
    // Saldo digital = receitas digitais - despesas pagas digitalmente (no mês)
    prisma.income.aggregate({ where: { userId, monthId, paymentMethod: { not: 'cash' } }, _sum: { value: true } }),
    prisma.expense.aggregate({ where: { userId, monthId, paymentMethod: { not: 'cash' }, deletedAt: null }, _sum: { paidAmount: true } }),
  ]);

  const incomeTotal    = Number(incomesAgg._sum.value ?? 0);
  const expensesPlanned = Number(allExpensesAgg._sum.value ?? 0);
  const expensesPaid   = Number(paidAgg._sum.paidAmount ?? 0);

  const goalNet = round2(
    goalMovements.reduce(
      (sum, c) => sum + (c.type === 'contribution' ? Number(c.value) : -Number(c.value)),
      0
    )
  );

  // Fetch savings net movement for this month
  const startDate = new Date(Date.UTC(month.year, month.month - 1, 1));
  const endDate   = new Date(Date.UTC(month.year, month.month, 0, 23, 59, 59));
  const savingsNet = await savingsService.getNetMovementInRange(userId, startDate, endDate);

  const currentBalance   = round2(incomeTotal - expensesPaid - savingsNet - goalNet);
  const projectedBalance = round2(incomeTotal - expensesPlanned - savingsNet - goalNet);

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
    recommendationsService.generateRecommendations(userId, monthId),
    getAverageRecentIncome(userId, monthId, 3),
  ]);

  const incomeRef      = avgIncome > 0 ? avgIncome : incomeTotal > 0 ? incomeTotal : 1;
  const commitmentRatio = round2(expensesPlanned / incomeRef);
  const commitmentBand  = classifyCommitment(commitmentRatio);

  return {
    month,
    incomeTotal: round2(incomeTotal),
    expensesPlanned: round2(expensesPlanned),
    expensesPaid: round2(expensesPaid),
    currentBalance,
    projectedBalance,
    savingsBalance,
    physicalCash,
    digitalCash,
    totalActiveDebt: round2(Number(debtsAgg._sum.remainingBalance ?? 0)),
    pendingExpensesCount: pendingCount,
    upcomingDueDates: pendingExpenses,
    cards,
    goals: goals.filter((g) => g.status === 'active'),
    financialHealthScore,
    alerts,
    recommendations: recommendations.recommendations,
    commitment: {
      ratio: commitmentRatio,
      band: commitmentBand,
      label: { saudavel: 'Saudável', atencao: 'Atenção', risco: 'Risco', critico: 'Crítico' }[commitmentBand],
    },
  };
}

module.exports = { getDashboard };
