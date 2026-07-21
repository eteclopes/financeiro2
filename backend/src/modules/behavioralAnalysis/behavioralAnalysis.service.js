const prisma = require('../../config/prisma');
const monthsService = require('../months/months.service');
const { getAllMonthsChronological } = require('../_shared/financialMetrics');
const { round2 } = require('../../utils/math');

// ---- Tendência linear simples (regressão por mínimos quadrados) ----
// Retorna slope (variação média por período) e direction (up/down/stable).
function linearTrend(values) {
  const n = values.length;
  if (n < 2) return { slope: 0, direction: 'stable' };
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (values[i] - yMean);
    den += (i - xMean) ** 2;
  }
  const slope = den !== 0 ? round2(num / den) : 0;
  const direction = Math.abs(slope) < 0.5 ? 'stable' : slope > 0 ? 'up' : 'down';
  return { slope, direction };
}

async function getBehavioralAnalysis(userId, monthId, periods = 6) {
  await monthsService.getMonthOrThrow(userId, monthId);

  const allMonths = await getAllMonthsChronological(userId);
  const idx = allMonths.findIndex((m) => m.id === monthId);
  const slice = allMonths.slice(Math.max(0, idx - periods + 1), idx + 1);

  if (slice.length === 0) return { periods: 0, analysis: null };

  const sliceIds = slice.map((m) => m.id);

  // Antes: 1 aggregate() por mês, POR série (receita, despesa, cartão,
  // dívida) — com periods=12 isso chegava a ~36-48 queries individuais
  // numa única requisição. Agora: 1 groupBy por série, sempre, não importa
  // quantos períodos — mesma técnica que expensesByCategory já usava logo
  // abaixo, só não tinha sido aplicada aqui.
  function seriesFromGroupBy(rows, ids) {
    const byMonth = new Map(rows.map((r) => [String(r.monthId), Number(r._sum.value ?? 0)]));
    return ids.map((id) => byMonth.get(String(id)) ?? 0);
  }

  const [incomeRows, expenseRows, cardExpenseRows, debtExpenseRows] = await Promise.all([
    prisma.income.groupBy({ by: ['monthId'], where: { userId, monthId: { in: sliceIds } }, _sum: { value: true } }),
    prisma.expense.groupBy({
      by: ['monthId'],
      where: { userId, monthId: { in: sliceIds }, deletedAt: null },
      _sum: { value: true },
    }),
    prisma.expense.groupBy({
      by: ['monthId'],
      where: { userId, monthId: { in: sliceIds }, type: 'card', deletedAt: null },
      _sum: { value: true },
    }),
    prisma.expense.groupBy({
      by: ['monthId'],
      where: { userId, monthId: { in: sliceIds }, type: 'priority', deletedAt: null },
      _sum: { value: true },
    }),
  ]);

  // ---- Receita e despesa por mês ----
  const incomeByMonth = seriesFromGroupBy(incomeRows, sliceIds);
  const expenseByMonth = seriesFromGroupBy(expenseRows, sliceIds);

  const incomeTrend = linearTrend(incomeByMonth);
  const expenseTrend = linearTrend(expenseByMonth);

  // ---- Gastos por categoria mês a mês ----
  const expensesByCategory = await prisma.expense.groupBy({
    by: ['categoryId', 'monthId'],
    where: { userId, monthId: { in: sliceIds }, deletedAt: null },
    _sum: { value: true },
  });

  const categoryIds = [...new Set(expensesByCategory.map((r) => r.categoryId))];
  const categories = await prisma.category.findMany({ where: { id: { in: categoryIds } } });
  const catMap = Object.fromEntries(categories.map((c) => [String(c.id), c.name]));

  // Para cada categoria, monta a série por mês e calcula tendência
  const categoryTrends = categoryIds.map((catId) => {
    const series = sliceIds.map((monthId) => {
      const row = expensesByCategory.find(
        (r) => r.categoryId === catId && r.monthId === monthId
      );
      return row ? Number(row._sum.value ?? 0) : 0;
    });
    const trend = linearTrend(series);
    const lastValue = series[series.length - 1];
    const firstValue = series[0];
    const growthPct = firstValue > 0 ? round2(((lastValue - firstValue) / firstValue) * 100) : null;
    return {
      categoryId: String(catId),
      categoryName: catMap[String(catId)] ?? 'Desconhecida',
      series,
      trend: trend.direction,
      slope: trend.slope,
      growthPercent: growthPct,
      lastValue,
      excessive: trend.direction === 'up' && (growthPct ?? 0) >= 20,
    };
  }).sort((a, b) => (b.growthPercent ?? -Infinity) - (a.growthPercent ?? -Infinity));

  // ---- Dependência de cartão ----
  const cardExpenseByMonth = seriesFromGroupBy(cardExpenseRows, sliceIds);
  const cardDependency = expenseByMonth.map((total, i) =>
    total > 0 ? round2((cardExpenseByMonth[i] / total) * 100) : 0
  );
  const cardDepTrend = linearTrend(cardDependency);

  // ---- Evolução do endividamento ----
  const debtBalancesByMonth = seriesFromGroupBy(debtExpenseRows, sliceIds);
  const debtTrend = linearTrend(debtBalancesByMonth);

  // ---- Detecção de anomalias: mês com gasto > média + 1.5×desvio padrão ----
  const mean = expenseByMonth.reduce((a, b) => a + b, 0) / expenseByMonth.length;
  const std = Math.sqrt(expenseByMonth.reduce((sum, v) => sum + (v - mean) ** 2, 0) / expenseByMonth.length);
  const anomalyMonths = slice
    .filter((_, i) => expenseByMonth[i] > mean + 1.5 * std)
    .map((m, i) => ({ month: m.month, year: m.year, value: expenseByMonth[slice.indexOf(m)] }));

  const monthLabels = slice.map((m) => ({ month: m.month, year: m.year }));

  return {
    periods: slice.length,
    monthLabels,
    income: { series: incomeByMonth, trend: incomeTrend.direction, slope: incomeTrend.slope },
    expenses: { series: expenseByMonth, trend: expenseTrend.direction, slope: expenseTrend.slope },
    categoryTrends,
    cardDependency: { series: cardDependency, trend: cardDepTrend.direction, slope: cardDepTrend.slope },
    debtInstallments: { series: debtBalancesByMonth, trend: debtTrend.direction },
    anomalyMonths,
    highlights: buildHighlights({ incomeTrend, expenseTrend, categoryTrends, cardDepTrend, debtTrend }),
  };
}

function buildHighlights({ incomeTrend, expenseTrend, categoryTrends, cardDepTrend, debtTrend }) {
  const items = [];
  if (incomeTrend.direction === 'down') items.push({ severity: 'warning', text: 'Tendência de queda na receita detectada.' });
  if (expenseTrend.direction === 'up') items.push({ severity: 'warning', text: 'Tendência de aumento nos gastos totais.' });
  const excessiveCategories = categoryTrends.filter((c) => c.excessive);
  for (const cat of excessiveCategories.slice(0, 3)) {
    items.push({ severity: 'warning', text: `Categoria "${cat.categoryName}" cresceu ${cat.growthPercent?.toFixed(0)}% no período.` });
  }
  if (cardDepTrend.direction === 'up') items.push({ severity: 'info', text: 'Dependência de cartão de crédito em crescimento.' });
  if (debtTrend.direction === 'up') items.push({ severity: 'warning', text: 'Gastos com parcelas de dívida em crescimento.' });
  if (items.length === 0) items.push({ severity: 'info', text: 'Comportamento financeiro estável no período analisado.' });
  return items;
}

module.exports = { getBehavioralAnalysis };
