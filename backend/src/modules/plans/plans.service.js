const prisma = require('../../config/prisma');
const AppError = require('../../utils/AppError');

const BASIC_LIMITS = Object.freeze({ activeCards: 2 });

function isProPlan(user) {
  if (!user || user.plan !== 'pro') return false;
  return !user.planExpiresAt || new Date(user.planExpiresAt).getTime() > Date.now();
}

function buildEntitlements(user) {
  const isPro = isProPlan(user);
  return {
    plan: isPro ? 'pro' : 'basic',
    isPro,
    source: isPro ? user.planSource : 'basic',
    grantedAt: isPro ? user.planGrantedAt : null,
    expiresAt: isPro ? user.planExpiresAt : null,
    limits: {
      activeCards: isPro ? null : BASIC_LIMITS.activeCards,
    },
    features: {
      coreFinance: true,
      recurringIncomes: true,
      fixedExpenses: true,
      cardsAndInvoices: true,
      budgets: true,
      goalsAndSavings: true,
      purchaseSimulator: isPro,
      whatIfSimulator: isPro,
      advancedTrends: isPro,
      advancedRecommendations: isPro,
      advancedReports: isPro,
      calculators: isPro,
      futureProjections: isPro,
      cardAnalytics: isPro,
      goalPlanning: isPro,
      debtPlanning: isPro,
      dashboardPersonalization: isPro,
      planningHub: isPro,
    },
  };
}

async function getUserPlan(userId, client = prisma) {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      plan: true,
      planSource: true,
      planGrantedAt: true,
      planExpiresAt: true,
      stripeCustomerId: true,
    },
  });
  if (!user) throw new AppError('Usuário não encontrado.', 404, 'USER_NOT_FOUND');
  return { user, entitlements: buildEntitlements(user) };
}

async function assertPro(userId, client = prisma) {
  const { user, entitlements } = await getUserPlan(userId, client);
  if (!entitlements.isPro) {
    throw new AppError(
      'Este recurso faz parte do Plano Pro.',
      403,
      'PRO_REQUIRED',
      { upgradePath: '/plan' }
    );
  }
  return user;
}

async function grantLifetimePro(userId, source = 'stripe_lifetime', client = prisma) {
  return client.user.update({
    where: { id: userId },
    data: {
      plan: 'pro',
      planSource: source,
      planGrantedAt: new Date(),
      planExpiresAt: null,
    },
  });
}

async function revokeStripeProIfNoPaidPurchase(userId, client = prisma) {
  const user = await client.user.findUnique({ where: { id: userId } });
  if (!user || user.planSource !== 'stripe_lifetime') return user;
  const paidPurchase = await client.billingPurchase.findFirst({
    where: { userId, status: 'paid' },
    select: { id: true },
  });
  if (paidPurchase) return user;
  return client.user.update({
    where: { id: userId },
    data: {
      plan: 'basic',
      planSource: 'basic',
      planGrantedAt: null,
      planExpiresAt: null,
    },
  });
}

module.exports = {
  BASIC_LIMITS,
  isProPlan,
  buildEntitlements,
  getUserPlan,
  assertPro,
  grantLifetimePro,
  revokeStripeProIfNoPaidPurchase,
};
