const { Router } = require('express');
const asyncHandler = require('../../utils/asyncHandler');
const authenticate = require('../../middlewares/authenticate');
const { parseMonthId } = require('../../utils/parseParams');
const dashboardService = require('../dashboard/dashboard.service');
const { getUserPlan } = require('../plans/plans.service');

const router = Router();
router.use(authenticate);

/**
 * Relatório mensal.
 *
 * ANTES: a rota inteira exigia Pro (`requirePro`). A tela de Relatórios do
 * frontend não era protegida, então o usuário Básico clicava no menu,
 * recebia 403 e via uma PÁGINA EM BRANCO. Um gestor financeiro básico
 * precisa conseguir ver o resumo do próprio mês.
 *
 * AGORA: a rota responde 200 para todos e o payload é dividido por plano.
 *   Básico -> resumo do mês, receitas, despesas, saldo, patrimônio,
 *             categorias dos vencimentos e histórico básico.
 *   Pro    -> acrescenta análises avançadas (recomendações, projeções,
 *             score detalhado e comparativos).
 *
 * O gating continua sendo do BACKEND — o frontend só desenha o que veio.
 */
function basicReport(dashboard) {
  return {
    month: dashboard.month,
    historicalSnapshot: dashboard.historicalSnapshot,
    openingBalance: dashboard.openingBalance,
    incomeTotal: dashboard.incomeTotal,
    expensesPlanned: dashboard.expensesPlanned,
    expensesPaid: dashboard.expensesPaid,
    currentBalance: dashboard.currentBalance,
    projectedBalance: dashboard.projectedBalance,
    savingsBalance: dashboard.savingsBalance,
    physicalCash: dashboard.physicalCash,
    totalActiveDebt: dashboard.totalActiveDebt,
    pendingExpensesCount: dashboard.pendingExpensesCount,
    wealth: dashboard.wealth,
    debtIndicators: dashboard.debtIndicators,
    upcomingDueDates: dashboard.upcomingDueDates,
    cards: dashboard.cards,
    goals: dashboard.goals,
    alerts: dashboard.alerts,
    commitment: dashboard.commitment,
  };
}

router.get('/', asyncHandler(async (req, res) => {
  const monthId = parseMonthId(req.query);
  const [dashboard, { entitlements }] = await Promise.all([
    dashboardService.getDashboard(req.userId, monthId),
    getUserPlan(req.userId),
  ]);

  const report = basicReport(dashboard);
  res.json({
    ...report,
    tier: entitlements.isPro ? 'pro' : 'basic',
    // Blocos avançados só existem no payload quando o plano permite.
    advanced: entitlements.isPro
      ? {
          financialHealthScore: dashboard.financialHealthScore,
          recommendations: dashboard.recommendations,
        }
      : null,
    proFeatures: {
      advancedReports: entitlements.features.advancedReports,
      advancedRecommendations: entitlements.features.advancedRecommendations,
      futureProjections: entitlements.features.futureProjections,
    },
  });
}));

module.exports = router;
