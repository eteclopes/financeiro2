const prisma = require('../../config/prisma');
const monthsService = require('../months/months.service');
const cardsService = require('../cards/cards.service');
const goalsService = require('../goals/goals.service');
const savingsService = require('../savings/savings.service');
const cardInvoicesService = require('../cards/cardInvoices.service');
const financialHealthService = require('../financialHealth/financialHealth.service');
const alertsService = require('../alerts/alerts.service');
const recommendationsService = require('../recommendations/recommendations.service');
const { classifyCommitment } = require('../_shared/commitment');
const { getAverageRecentIncome } = require('../_shared/financialMetrics');
const { getAvailableBalance, getBalanceAsOf } = require('../_shared/balance');
const { monthDateRange } = require('../../utils/dateTime');
const { round2 } = require('../../utils/math');
const { getUserPlan } = require('../plans/plans.service');
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
async function getWealthBreakdown(userId, facts, client = prisma, { frozen = false } = {}) {
  let goalsBalance;
  if (frozen) {
    goalsBalance = round2(Number(facts.goalsBalance ?? 0));
  } else {
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
    goalsBalance = round2(
      Number(contributions._sum.value ?? 0) - Number(refunds._sum.value ?? 0)
    );
  }
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

function commitmentFromSummary(summary, averageIncome) {
  const incomeRef = averageIncome > 0
    ? averageIncome
    : Number(summary.incomeTotal) > 0
      ? Number(summary.incomeTotal)
      : 1;
  const ratio = round2(Number(summary.expensesPlanned) / incomeRef);
  const band = classifyCommitment(ratio);
  return {
    ratio,
    band,
    label: { saudavel: 'Saudável', atencao: 'Atenção', risco: 'Risco', critico: 'Crítico' }[band],
  };
}

async function getClosedDashboard(userId, month, entitlements) {
  // Um mês fechado não consulta nenhum indicador vivo: tudo vem do retrato
  // congelado. Assim, estornos ou metas atuais não reescrevem o passado.
  const rawFacts = await getMonthFacts(userId, month);
  const summary = normalizeFacts(rawFacts);
  const wealth = await getWealthBreakdown(userId, summary, prisma, { frozen: true });
  return {
    month,
    wealth,
    debtIndicators: {
      totalRemainingBalance: Number(summary.totalActiveDebt),
      activeDebtsCount: Number(summary.activeDebtsCount ?? 0),
      remainingInstallments: Number(summary.remainingInstallments ?? 0),
      nextInstallment: null,
      historical: true,
    },
    historicalSnapshot: rawFacts ? {
      version: Number(rawFacts.version ?? 1),
      capturedAt: rawFacts.capturedAt ?? null,
      reconstructed: Boolean(rawFacts.reconstructed),
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
    upcomingDueDates: [],
    openInvoices: [],
    cards: [],
    goals: [],
    financialHealthScore: summary.financialHealthScore == null
      ? null
      : { score: Number(summary.financialHealthScore), historical: true },
    alerts: [],
    recommendations: [],
    proAccess: {
      recommendations: entitlements.features.advancedRecommendations,
      projections: entitlements.features.futureProjections,
    },
    commitment: commitmentFromSummary(summary, Number(summary.incomeTotal)),
  };
}

async function getDashboard(userId, monthId) {
  const [month, planInfo] = await Promise.all([
    monthsService.getMonthOrThrow(userId, monthId),
    getUserPlan(userId),
  ]);
  const { entitlements } = planInfo;
  if (month.status === 'closed') {
    return getClosedDashboard(userId, month, entitlements);
  }
  // Consultas são puras. Um mês legado sem snapshot é sinalizado por
  // getMonthFacts; reparos acontecem apenas por comando explícito.
  const refreshedMonth = month;
  const { start, end } = monthDateRange(month.year, month.month);
  const dayBeforeStart = new Date(start.getTime() - 1);

  const [
    incomesAgg,
    allExpensesAgg,
    paidAgg,
    reversedAgg,
    outstandingAgg,
    pendingExpenses,
    pendingCount,
    openInvoiceRows,
    debtsAgg,
    savingsBalance,
    goalMovements,
    cashIncomesAgg,
    cashIncomeReversalsAgg,
    cashExpensesPaidAgg,
    cashExpensesReversedAgg,
    digitalIncomesAgg,
    digitalIncomeReversalsAgg,
    digitalExpensesPaidAgg,
    digitalExpensesReversedAgg,
    openingBalance,
    currentBalance,
    monthEndBalance,
  ] = await Promise.all([
    prisma.income.aggregate({ where: { userId, monthId }, _sum: { value: true, reversedAmount: true } }),
    prisma.expense.aggregate({ where: { userId, monthId, deletedAt: null }, _sum: { value: true } }),
    prisma.expense.aggregate({
      where: { userId, deletedAt: null, paidAt: { gte: start, lte: end } },
      _sum: { paidAmount: true },
    }),
    prisma.expense.aggregate({
      where: { userId, deletedAt: null, reversedAt: { gte: start, lte: end } },
      _sum: { reversedAmount: true },
    }),
    // PENDÊNCIAS DO MÊS — parcelas de CARTÃO ficam de fora.
    //
    // Uma compra no crédito não é uma conta a pagar do mês: ela pertence à
    // fatura e só vira saída de dinheiro quando a fatura é quitada. Enquanto
    // entravam aqui, três coisas quebravam ao mesmo tempo:
    //   1. a soma de pendências inflava, dando a impressão de que a compra
    //      já tinha comido o saldo;
    //   2. a parcela aparecia na lista do "Pagar conta"; e
    //   3. ao escolhê-la, o pagamento era recusado com 409 PAY_VIA_INVOICE,
    //      porque parcela de cartão só se quita pagando a fatura.
    // A fatura em aberto é exposta à parte, em `openInvoices`.
    prisma.expense.aggregate({
      where: { userId, monthId, deletedAt: null, type: { not: 'card' }, status: { in: ['pending', 'partial', 'late'] } },
      _sum: { value: true, paidAmount: true },
    }),
    prisma.expense.findMany({
      where: { userId, monthId, deletedAt: null, type: { not: 'card' }, status: { in: ['pending', 'partial', 'late'] } },
      include: { category: true, cardInvoice: { include: { card: true } } },
      orderBy: { dueDate: 'asc' },
      take: 5,
    }),
    prisma.expense.count({
      where: { userId, monthId, deletedAt: null, type: { not: 'card' }, status: { in: ['pending', 'partial', 'late'] } },
    }),
    // Faturas em aberto: a contrapartida das parcelas de cartão que saíram
    // das pendências. Ficam visíveis como UM item por fatura, que é como a
    // dívida realmente se apresenta e como ela é paga.
    prisma.cardInvoice.findMany({
      where: {
        card: { userId },
        expenses: { some: { deletedAt: null, status: { in: ['pending', 'partial', 'late'] } } },
      },
      include: {
        card: { select: { id: true, name: true } },
        expenses: { where: { deletedAt: null, status: { in: ['pending', 'partial', 'late'] } }, select: { value: true, paidAmount: true } },
      },
      orderBy: { dueDate: 'asc' },
    }),
    prisma.debt.aggregate({ where: { userId, status: 'active' }, _sum: { remainingBalance: true } }),
    savingsService.getCurrentBalance(userId),
    prisma.goalContribution.findMany({ where: { monthId, goal: { userId } } }),
    prisma.income.aggregate({
      where: { userId, origin: 'physical', effectiveDate: { gte: start, lte: end } },
      _sum: { value: true },
    }),
    prisma.income.aggregate({
      where: { userId, origin: 'physical', reversedAt: { gte: start, lte: end } },
      _sum: { reversedAmount: true },
    }),
    prisma.expense.aggregate({
      where: { userId, paymentMethod: 'cash', deletedAt: null, paidAt: { gte: start, lte: end } },
      _sum: { paidAmount: true },
    }),
    prisma.expense.aggregate({
      where: { userId, paymentMethod: 'cash', deletedAt: null, reversedAt: { gte: start, lte: end } },
      _sum: { reversedAmount: true },
    }),
    prisma.income.aggregate({
      where: { userId, origin: 'digital', effectiveDate: { gte: start, lte: end } },
      _sum: { value: true },
    }),
    prisma.income.aggregate({
      where: { userId, origin: 'digital', reversedAt: { gte: start, lte: end } },
      _sum: { reversedAmount: true },
    }),
    prisma.expense.aggregate({
      where: { userId, paymentMethod: { not: 'cash' }, deletedAt: null, paidAt: { gte: start, lte: end } },
      _sum: { paidAmount: true },
    }),
    prisma.expense.aggregate({
      where: { userId, paymentMethod: { not: 'cash' }, deletedAt: null, reversedAt: { gte: start, lte: end } },
      _sum: { reversedAmount: true },
    }),
    getBalanceAsOf(userId, dayBeforeStart),
    getAvailableBalance(userId),
    getBalanceAsOf(userId, end),
  ]);

  const incomeTotal = round2(Number(incomesAgg._sum.value ?? 0) - Number(incomesAgg._sum.reversedAmount ?? 0));
  const expensesPlanned = Number(allExpensesAgg._sum.value ?? 0);
  const expensesPaid = round2(Number(paidAgg._sum.paidAmount ?? 0) - Number(reversedAgg._sum.reversedAmount ?? 0));
  const outstanding = round2(
    Number(outstandingAgg._sum.value ?? 0) - Number(outstandingAgg._sum.paidAmount ?? 0)
  );
  const goalNet = round2(goalMovements.reduce(
    (sum, item) => sum + (item.type === 'contribution' ? Number(item.value) : -Number(item.value)),
    0
  ));
  const savingsNet = await savingsService.getNetMovementInRange(userId, start, end);
  const physicalCash = round2(
    Number(cashIncomesAgg._sum.value ?? 0)
    - Number(cashIncomeReversalsAgg._sum.reversedAmount ?? 0)
    - Number(cashExpensesPaidAgg._sum.paidAmount ?? 0)
    + Number(cashExpensesReversedAgg._sum.reversedAmount ?? 0)
  );
  const digitalCash = round2(
    Number(digitalIncomesAgg._sum.value ?? 0)
    - Number(digitalIncomeReversalsAgg._sum.reversedAmount ?? 0)
    - Number(digitalExpensesPaidAgg._sum.paidAmount ?? 0)
    + Number(digitalExpensesReversedAgg._sum.reversedAmount ?? 0)
  );

  const [cards, goals, financialHealthScore, alerts, recommendations, avgIncome] = await Promise.all([
    cardsService.listCards(userId),
    goalsService.listGoals(userId),
    financialHealthService.getOrComputeHealthScore(userId, monthId),
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
  const summary = normalizeFacts(liveSummary);
  const [wealth, debtIndicators] = await Promise.all([
    getWealthBreakdown(userId, summary),
    debtsService.getDebtIndicators(userId),
  ]);

  return {
    month: refreshedMonth,
    wealth,
    // Números REAIS de dívida. O Dashboard não deve mais derivar
    // "parcelas restantes" da lista truncada de próximos vencimentos.
    debtIndicators,
    historicalSnapshot: null,
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
    // Mês fechado não recebe estado vivo de faturas; snapshots antigos não
    // tinham esse detalhe, então preferimos omitir a inventar histórico.
    openInvoices: (openInvoiceRows ?? []).map((invoice) => ({
      id: String(invoice.id),
      cardName: invoice.card?.name ?? null,
      referenceMonth: invoice.referenceMonth,
      referenceYear: invoice.referenceYear,
      dueDate: invoice.dueDate,
      status: cardInvoicesService.invoiceStatusWithOutstanding(invoice.closingDate),
      amount: round2(invoice.expenses.reduce(
        (sum, e) => sum + (Number(e.value) - Number(e.paidAmount ?? 0)), 0
      )),
    })).filter((invoice) => invoice.amount > 0),
    cards,
    goals: goals.filter((goal) => goal.status === 'active'),
    financialHealthScore,
    alerts,
    recommendations: recommendations.recommendations,
    proAccess: {
      recommendations: entitlements.features.advancedRecommendations,
      projections: entitlements.features.futureProjections,
    },
    commitment: commitmentFromSummary(summary, avgIncome),
  };
}

module.exports = { getDashboard };
