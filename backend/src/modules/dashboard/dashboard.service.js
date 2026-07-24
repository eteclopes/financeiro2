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
const { getMonthFacts, normalizeFacts } = require('../months/monthFacts.service');
const debtsService = require('../debts/debts.service');

/**
 * Patrimônio financeiro (regra 8.5 do produto):
 *   saldo disponível + dinheiro físico + reservas + acumulado em metas
 *
 * Existe para que MOVER dinheiro entre esses componentes nunca pareça
 * ganho nem perda. Era exatamente o que faltava no Dashboard: um aporte
 * em meta saía do saldo e não reaparecia em card nenhum, dando a
 * impressão de dinheiro perdido.
 */
async function getWealthBreakdown(userId, facts, client = prisma) {
  const [contributions, refunds] = await Promise.all([
    client.goalContribution.aggregate({
      where: { goal: { userId }, type: 'contribution' },
      _sum: { value: true },
    }),
    client.goalContribution.aggregate({
      where: { goal: { userId }, type: 'refund' },
      _sum: { value: true },
    }),
  ]);

  const goalsBalance = round2(
    Number(contributions._sum.value ?? 0) - Number(refunds._sum.value ?? 0)
  );
  const availableBalance = round2(Number(facts.currentBalance));
  const physicalCash = round2(Number(facts.physicalCash));
  const savingsBalance = round2(Number(facts.savingsBalance));
  const totalDebt = round2(Number(facts.totalActiveDebt));

  // `currentBalance` já é o caixa total do usuário (conta + espécie).
  // `physicalCash` é o recorte em espécie desse mesmo caixa — por isso NÃO
  // é somado de novo aqui: seria contagem dupla.
  const financialWealth = round2(availableBalance + savingsBalance + goalsBalance);

  return {
    availableBalance,
    physicalCash,
    savingsBalance,
    goalsBalance,
    financialWealth,
    totalDebt,
    netWealth: round2(financialWealth - totalDebt),
  };
}

async function getDashboard(userId, monthId) {
  const [month, planInfo] = await Promise.all([
    monthsService.getMonthOrThrow(userId, monthId),
    getUserPlan(userId),
  ]);
  const { entitlements } = planInfo;
  // Mês fechado sem snapshot (base anterior à V19) ganha o retrato agora;
  // mês fechado COM snapshot nunca é recalculado nem sobrescrito.
  if (month.status === 'closed') await ensureClosedMonthSnapshot(userId, month);
  const refreshedMonth = month.status === 'closed'
    ? await monthsService.getMonthOrThrow(userId, monthId)
    : month;
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
    // Antes: `refreshAlerts` gravava no banco a CADA carregamento do
    // Dashboard. Agora recomputa no máximo uma vez por minuto por mês.
    alertsService.getAlerts(userId, monthId),
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
  // Fonte única de verdade: mês fechado usa o snapshot congelado; mês
  // aberto usa os números vivos calculados acima.
  const closedSnapshot = refreshedMonth.status === 'closed'
    ? await getMonthFacts(userId, refreshedMonth)
    : null;
  const summary = normalizeFacts(closedSnapshot ?? liveSummary);
  const [wealth, debtIndicators] = await Promise.all([
    getWealthBreakdown(userId, summary),
    debtsService.getDebtIndicators(userId),
  ]);

  const incomeRef = avgIncome > 0
    ? avgIncome
    : Number(summary.incomeTotal) > 0
      ? Number(summary.incomeTotal)
      : 1;
  const commitmentRatio = round2(Number(summary.expensesPlanned) / incomeRef);
  const commitmentBand = classifyCommitment(commitmentRatio);

  return {
    month: refreshedMonth,
    wealth,
    // Números REAIS de dívida. O Dashboard não deve mais derivar
    // "parcelas restantes" da lista truncada de próximos vencimentos.
    debtIndicators,
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
