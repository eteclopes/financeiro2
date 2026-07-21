const prisma = require('../../config/prisma');
const monthsService = require('../months/months.service');
const savingsService = require('../savings/savings.service');
const cardsService = require('../cards/cards.service');
const { getRecentMonths } = require('../_shared/financialMetrics');
const { round2 } = require('../../utils/math');

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Todas as fórmulas abaixo são lógica matemática determinística — nenhuma
 * IA/modelo é usada. Os limiares (6 meses de reserva, 5x renda de dívida
 * etc.) são parâmetros de negócio documentados aqui; mover para uma tabela
 * de configuração por usuário é a evolução natural ("pesos configuráveis"
 * já prevista nas regras oficiais do projeto), mas não é necessária agora.
 */

// ---- Fator 1: Reserva financeira adequada (0-20) ----
// Meta de referência: 6 meses de despesa média coberta pelo saldo guardado.
function scoreReserve(savingsBalance, avgMonthlyExpense) {
  let reserveMonths;
  if (avgMonthlyExpense <= 0) {
    reserveMonths = savingsBalance > 0 ? 6 : 0;
  } else {
    reserveMonths = savingsBalance / avgMonthlyExpense;
  }
  const points = clamp(Math.round(20 * (reserveMonths / 6)), 0, 20);
  const reason =
    points >= 15
      ? 'Reserva financeira saudável'
      : points > 0
      ? `Reserva cobre ${reserveMonths.toFixed(1)} mês(es) de despesas`
      : 'Reserva financeira insuficiente';
  return { points, max: 20, reserveMonths: round2(reserveMonths), reason };
}

// ---- Fator 2: Receita maior que despesas (0-20) ----
// Margem de 20% ou mais da receita já é considerada saudável (nota máxima).
function scoreIncomeVsExpense(incomeTotal, expensesPlanned) {
  const margin = incomeTotal > 0 ? (incomeTotal - expensesPlanned) / incomeTotal : expensesPlanned > 0 ? -1 : 0;
  const points = clamp(Math.round(20 * (margin / 0.2)), 0, 20);
  const reason =
    margin >= 0.2
      ? 'Receita confortavelmente maior que as despesas'
      : margin >= 0
      ? `Margem positiva, mas estreita (${Math.round(margin * 100)}%)`
      : 'Despesas previstas superam a receita do mês';
  return { points, max: 20, marginPercent: round2(margin * 100), reason };
}

// ---- Fator 3: Sem atrasos (0-20) ----
function scoreNoLate(lateCount) {
  const points = clamp(20 - lateCount * 5, 0, 20);
  const reason = lateCount === 0 ? 'Nenhuma conta atrasada' : `${lateCount} conta(s) em atraso`;
  return { points, max: 20, lateCount, reason };
}

// ---- Fator 4: Uso saudável dos cartões (0-15) ----
function scoreCardUsage(cards) {
  const withLimit = cards.filter((c) => Number(c.limitValue) > 0);
  if (withLimit.length === 0) {
    return { points: 15, max: 15, averageUtilization: 0, reason: 'Sem cartões ativos' };
  }
  const avgUtilization =
    withLimit.reduce((sum, c) => sum + c.usedLimit / Number(c.limitValue), 0) / withLimit.length;

  let points;
  if (avgUtilization <= 0.3) points = 15;
  else if (avgUtilization <= 0.5) points = 10;
  else if (avgUtilization <= 0.8) points = 5;
  else points = 0;

  const pct = Math.round(avgUtilization * 100);
  const reason =
    points === 15
      ? `Cartões usando apenas ${pct}% do limite`
      : `Cartões utilizando ${pct}% do limite em média`;
  return { points, max: 15, averageUtilization: pct, reason };
}

// ---- Fator 5: Baixo endividamento (0-15) ----
// Referência: dívida ativa total acima de 5x a renda mensal zera a nota.
function scoreDebt(totalActiveDebt, incomeTotal) {
  const ratio = incomeTotal > 0 ? totalActiveDebt / incomeTotal : totalActiveDebt > 0 ? 5 : 0;
  const points = clamp(Math.round(15 * (1 - ratio / 5)), 0, 15);
  const reason =
    points >= 12
      ? 'Endividamento baixo em relação à renda'
      : points > 0
      ? `Dívida ativa equivale a ${ratio.toFixed(1)}x a renda mensal`
      : 'Endividamento elevado em relação à renda';
  return { points, max: 15, debtToIncomeRatio: round2(ratio), reason };
}

// ---- Fator 6: Cumprimento de metas (0-10) ----
function scoreGoals(goals) {
  if (goals.length === 0) {
    return { points: 10, max: 10, reason: 'Sem metas ativas no momento' };
  }
  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  const onTrack = goals.filter(
    (g) => g.progress >= Number(g.targetValue) || (g.lastContributionDate && g.lastContributionDate >= sixtyDaysAgo)
  ).length;

  const points = Math.round(10 * (onTrack / goals.length));
  const reason = `${onTrack} de ${goals.length} meta(s) com aportes recentes`;
  return { points, max: 10, onTrack, totalGoals: goals.length, reason };
}

async function gatherMetrics(userId, monthId) {
  const month = await monthsService.getMonthOrThrow(userId, monthId);
  const recentMonths = await getRecentMonths(userId, monthId, 3);
  const recentMonthIds = recentMonths.map((m) => m.id);

  const [
    incomeAgg,
    expensesAgg,
    lateCount,
    recentExpensesAgg,
    savingsBalance,
    debtAgg,
    cardsRaw,
    activeGoals,
  ] = await Promise.all([
    prisma.income.aggregate({ where: { userId, monthId }, _sum: { value: true } }),
    prisma.expense.aggregate({ where: { userId, monthId, deletedAt: null }, _sum: { value: true } }),
    prisma.expense.count({ where: { userId, monthId, deletedAt: null, status: 'late' } }),
    prisma.expense.aggregate({
      where: { userId, monthId: { in: recentMonthIds }, deletedAt: null },
      _sum: { paidAmount: true },
    }),
    savingsService.getCurrentBalance(userId),
    prisma.debt.aggregate({ where: { userId, status: 'active' }, _sum: { remainingBalance: true } }),
    prisma.card.findMany({ where: { userId, active: true } }),
    prisma.goal.findMany({ where: { userId, status: 'active' }, include: { contributions: true } }),
  ]);

  const usedLimitByCard = await cardsService.computeUsedLimitsByCard(cardsRaw.map((c) => c.id));
  const cards = cardsRaw.map((card) => ({
    limitValue: card.limitValue,
    usedLimit: usedLimitByCard.get(String(card.id)) ?? 0,
  }));

  const goals = activeGoals.map((goal) => {
    const progress = goal.contributions.reduce(
      (sum, c) => sum + (c.type === 'contribution' ? Number(c.value) : -Number(c.value)),
      0
    );
    const contributionDates = goal.contributions
      .filter((c) => c.type === 'contribution')
      .map((c) => c.contributionDate);
    const lastContributionDate =
      contributionDates.length > 0 ? new Date(Math.max(...contributionDates.map((d) => d.getTime()))) : null;
    return { targetValue: goal.targetValue, progress, lastContributionDate };
  });

  return {
    month,
    incomeTotal: Number(incomeAgg._sum.value ?? 0),
    expensesPlanned: Number(expensesAgg._sum.value ?? 0),
    lateCount,
    avgMonthlyExpense:
      recentMonthIds.length > 0 ? Number(recentExpensesAgg._sum.paidAmount ?? 0) / recentMonthIds.length : 0,
    savingsBalance,
    totalActiveDebt: Number(debtAgg._sum.remainingBalance ?? 0),
    cards,
    goals,
  };
}

async function computeAndStore(userId, monthId) {
  const metrics = await gatherMetrics(userId, monthId);

  const reserve = scoreReserve(metrics.savingsBalance, metrics.avgMonthlyExpense);
  const incomeVsExpense = scoreIncomeVsExpense(metrics.incomeTotal, metrics.expensesPlanned);
  const noLate = scoreNoLate(metrics.lateCount);
  const cardUsage = scoreCardUsage(metrics.cards);
  const debt = scoreDebt(metrics.totalActiveDebt, metrics.incomeTotal);
  const goals = scoreGoals(metrics.goals);

  const breakdown = {
    reserve,
    incomeVsExpense,
    noLate,
    cardUsage,
    debt,
    goals,
  };

  const score = clamp(
    reserve.points + incomeVsExpense.points + noLate.points + cardUsage.points + debt.points + goals.points,
    0,
    100
  );

  const saved = await prisma.financialHealthScore.upsert({
    where: { monthId },
    update: { score, breakdownJson: breakdown },
    create: { userId, monthId, score, breakdownJson: breakdown },
  });

  return { score, breakdown, computedAt: saved.createdAt };
}

/**
 * Sempre recalcula na hora (não usa cache obsoleto) — é assim que a regra
 * "atualizar automaticamente quando houver movimentações" é satisfeita sem
 * precisar instalar hooks em todo service existente (receitas, despesas,
 * pagamentos, cartões...): o dado-fonte é sempre lido fresco.
 */
async function getOrComputeHealthScore(userId, monthId) {
  return computeAndStore(userId, monthId);
}

module.exports = { getOrComputeHealthScore, computeAndStore };
