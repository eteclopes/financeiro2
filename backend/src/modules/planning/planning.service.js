const prisma = require('../../config/prisma');
const AppError = require('../../utils/AppError');
const { round2 } = require('../../utils/math');
const { todayUtcDate } = require('../../utils/dateTime');

function clampDay(year, month, day) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 1, Math.min(Number(day), lastDay)));
}

function addMonths(month, year, delta) {
  const value = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { month: value.getUTCMonth() + 1, year: value.getUTCFullYear() };
}

function estimateCardPurchaseWindow(card, purchaseDate = todayUtcDate()) {
  const day = purchaseDate.getUTCDate();
  const current = { month: purchaseDate.getUTCMonth() + 1, year: purchaseDate.getUTCFullYear() };
  const reference = day <= Number(card.closingDay) ? current : addMonths(current.month, current.year, 1);
  const dueReference = Number(card.dueDay) <= Number(card.closingDay)
    ? addMonths(reference.month, reference.year, 1)
    : reference;
  const closingDate = clampDay(reference.year, reference.month, card.closingDay);
  const dueDate = clampDay(dueReference.year, dueReference.month, card.dueDay);
  const daysUntilDue = Math.max(Math.ceil((dueDate.getTime() - purchaseDate.getTime()) / 86_400_000), 0);
  return { closingDate, dueDate, daysUntilDue };
}

function computeGoalProgress(contributions = []) {
  return round2(contributions.reduce(
    (sum, item) => sum + (item.type === 'contribution' ? Number(item.value) : -Number(item.value)),
    0
  ));
}

function monthsUntilDate(targetDate, today = todayUtcDate()) {
  if (!targetDate) return null;
  const target = new Date(targetDate);
  const monthDiff = (target.getUTCFullYear() - today.getUTCFullYear()) * 12
    + (target.getUTCMonth() - today.getUTCMonth());
  return Math.max(monthDiff + (target.getUTCDate() >= today.getUTCDate() ? 1 : 0), 1);
}

function buildGoalPlan(goal, today = todayUtcDate()) {
  const progress = computeGoalProgress(goal.contributions);
  const remaining = round2(Math.max(Number(goal.targetValue) - progress, 0));
  const monthsLeft = monthsUntilDate(goal.targetDate, today);
  const recommendedMonthly = monthsLeft ? round2(remaining / monthsLeft) : null;
  const recentCutoff = new Date(today);
  recentCutoff.setUTCMonth(recentCutoff.getUTCMonth() - 3);
  const recent = goal.contributions.filter(
    (item) => item.type === 'contribution' && new Date(item.contributionDate) >= recentCutoff
  );
  const currentMonthlyPace = round2(recent.reduce((sum, item) => sum + Number(item.value), 0) / 3);
  const estimatedMonthsAtCurrentPace = remaining <= 0
    ? 0
    : currentMonthlyPace > 0 ? Math.ceil(remaining / currentMonthlyPace) : null;
  const status = remaining <= 0
    ? 'completed'
    : monthsLeft && (!currentMonthlyPace || currentMonthlyPace + 0.01 < recommendedMonthly) ? 'behind' : 'on_track';

  return {
    id: goal.id,
    name: goal.name,
    targetValue: Number(goal.targetValue),
    targetDate: goal.targetDate,
    progress,
    remaining,
    percentage: Number(goal.targetValue) > 0 ? round2((progress / Number(goal.targetValue)) * 100) : 0,
    monthsLeft,
    recommendedMonthly,
    currentMonthlyPace,
    estimatedMonthsAtCurrentPace,
    status,
  };
}

function buildDebtPlan(debts) {
  const active = debts
    .filter((debt) => debt.status === 'active' && Number(debt.remainingBalance) > 0)
    .map((debt) => {
      const remainingBalance = Number(debt.remainingBalance);
      const installmentValue = Number(debt.installmentValue);
      return {
        id: debt.id,
        description: debt.description,
        category: debt.category?.name ?? null,
        remainingBalance: round2(remainingBalance),
        installmentValue: round2(installmentValue),
        estimatedInstallments: installmentValue > 0 ? Math.ceil(remainingBalance / installmentValue) : null,
        flexiblePayment: debt.flexiblePayment,
      };
    });

  return {
    activeCount: active.length,
    totalRemaining: round2(active.reduce((sum, debt) => sum + debt.remainingBalance, 0)),
    monthlyCommitment: round2(active.reduce((sum, debt) => sum + debt.installmentValue, 0)),
    snowballOrder: [...active].sort((a, b) => a.remainingBalance - b.remainingBalance),
    highestBalanceOrder: [...active].sort((a, b) => b.remainingBalance - a.remainingBalance),
  };
}

function invoiceTotal(invoice) {
  return round2((invoice.expenses ?? []).reduce((sum, expense) => sum + Number(expense.value), 0));
}

async function getPlanningOverview(userId, monthId) {
  const month = await prisma.month.findFirst({ where: { id: monthId, userId } });
  if (!month) throw new AppError('Mês não encontrado.', 404, 'MONTH_NOT_FOUND');

  const today = todayUtcDate();
  const [debts, goals, cards, invoices, income] = await Promise.all([
    prisma.debt.findMany({
      where: { userId, status: 'active' },
      include: { category: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.goal.findMany({
      where: { userId, status: 'active' },
      include: { contributions: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.card.findMany({ where: { userId, active: true }, orderBy: { createdAt: 'asc' } }),
    prisma.cardInvoice.findMany({
      where: { card: { userId }, status: { in: ['open', 'closed'] } },
      include: {
        card: { select: { id: true, name: true, color: true } },
        expenses: { where: { deletedAt: null, status: { not: 'paid' } }, select: { value: true } },
      },
      orderBy: [{ referenceYear: 'asc' }, { referenceMonth: 'asc' }],
    }),
    prisma.income.aggregate({ where: { userId, monthId }, _sum: { value: true } }),
  ]);

  const usedExpenses = cards.length === 0 ? [] : await prisma.expense.findMany({
    where: {
      userId,
      type: 'card',
      status: { in: ['pending', 'partial', 'late'] },
      deletedAt: null,
      cardInvoice: { cardId: { in: cards.map((card) => card.id) } },
    },
    select: { value: true, cardInvoice: { select: { cardId: true } } },
  });
  const usedByCard = new Map();
  for (const expense of usedExpenses) {
    const key = String(expense.cardInvoice.cardId);
    usedByCard.set(key, (usedByCard.get(key) ?? 0) + Number(expense.value));
  }

  const cardPlans = cards.map((card) => {
    const used = round2(usedByCard.get(String(card.id)) ?? 0);
    const limit = Number(card.limitValue);
    const window = estimateCardPurchaseWindow(card, today);
    return {
      id: card.id,
      name: card.name,
      color: card.color,
      limitValue: limit,
      usedLimit: used,
      availableLimit: round2(Math.max(limit - used, 0)),
      usagePercentage: limit > 0 ? round2((used / limit) * 100) : 0,
      ...window,
    };
  });

  const invoiceForecastMap = new Map();
  const overdueInvoices = [];
  for (const invoice of invoices) {
    const total = invoiceTotal(invoice);
    const normalized = {
      id: invoice.id,
      cardId: invoice.card.id,
      cardName: invoice.card.name,
      cardColor: invoice.card.color,
      dueDate: invoice.dueDate,
      status: invoice.status,
      total,
    };
    if (new Date(invoice.dueDate).getTime() < today.getTime()) {
      overdueInvoices.push(normalized);
      continue;
    }
    const key = `${invoice.referenceYear}-${String(invoice.referenceMonth).padStart(2, '0')}`;
    const current = invoiceForecastMap.get(key) ?? {
      month: invoice.referenceMonth,
      year: invoice.referenceYear,
      total: 0,
      invoices: [],
    };
    current.total = round2(current.total + total);
    current.invoices.push(normalized);
    invoiceForecastMap.set(key, current);
  }
  const invoiceForecast = [...invoiceForecastMap.values()].slice(0, 6);

  const debtPlan = buildDebtPlan(debts);
  const goalPlans = goals.map((goal) => buildGoalPlan(goal, today));
  const monthlyIncome = Number(income._sum.value ?? 0);
  const smartAlerts = [];

  const criticalCard = cardPlans.find((card) => card.usagePercentage >= 80);
  if (criticalCard) smartAlerts.push({
    type: 'card_limit', severity: criticalCard.usagePercentage >= 95 ? 'critical' : 'warning',
    message: `${criticalCard.name} está com ${Math.round(criticalCard.usagePercentage)}% do limite comprometido.`,
  });
  if (monthlyIncome > 0 && debtPlan.monthlyCommitment / monthlyIncome >= 0.3) smartAlerts.push({
    type: 'debt_commitment', severity: debtPlan.monthlyCommitment / monthlyIncome >= 0.5 ? 'critical' : 'warning',
    message: `As parcelas de dívidas comprometem ${Math.round((debtPlan.monthlyCommitment / monthlyIncome) * 100)}% das receitas deste mês.`,
  });
  const behindGoal = goalPlans.find((goal) => goal.status === 'behind');
  if (behindGoal) smartAlerts.push({
    type: 'goal_pace', severity: 'info',
    message: `A meta “${behindGoal.name}” precisa de aproximadamente R$ ${Number(behindGoal.recommendedMonthly).toFixed(2).replace('.', ',')} por mês para chegar no prazo.`,
  });

  const bestCard = [...cardPlans]
    .filter((card) => card.availableLimit > 0)
    .sort((a, b) => b.daysUntilDue - a.daysUntilDue || b.availableLimit - a.availableLimit)[0] ?? null;

  return {
    referenceMonth: { id: month.id, month: month.month, year: month.year },
    debtPlan,
    goalPlans,
    cards: {
      totalLimit: round2(cardPlans.reduce((sum, card) => sum + card.limitValue, 0)),
      totalUsed: round2(cardPlans.reduce((sum, card) => sum + card.usedLimit, 0)),
      plans: cardPlans,
      bestCard,
      invoiceForecast,
      overdueInvoices,
    },
    smartAlerts,
  };
}

module.exports = {
  clampDay,
  addMonths,
  estimateCardPurchaseWindow,
  computeGoalProgress,
  monthsUntilDate,
  buildGoalPlan,
  buildDebtPlan,
  getPlanningOverview,
};
