const prisma = require('../../config/prisma');
const monthsService = require('../months/months.service');
const savingsService = require('../savings/savings.service');
const { getAllMonthsChronological } = require('../_shared/financialMetrics');
const { round2 } = require('../../utils/math');

const PERIODS = { 3: 3, 6: 6, 12: 12 };

async function getFinancialHistory(userId, monthId, periodMonths = 6) {
  await monthsService.getMonthOrThrow(userId, monthId);
  const clampedPeriod = PERIODS[periodMonths] ?? 6;

  const allMonths = await getAllMonthsChronological(userId);
  const idx = allMonths.findIndex((m) => m.id === monthId);
  const slice = allMonths.slice(Math.max(0, idx - clampedPeriod + 1), idx + 1);

  if (slice.length === 0) return { periods: 0, months: [] };

  const monthsData = await Promise.all(slice.map(async (month) => {
    const [incomeAgg, expensesAgg, paidAgg, healthScore] = await Promise.all([
      prisma.income.aggregate({ where: { userId, monthId: month.id }, _sum: { value: true } }),
      prisma.expense.aggregate({ where: { userId, monthId: month.id, deletedAt: null }, _sum: { value: true } }),
      prisma.expense.aggregate({ where: { userId, monthId: month.id, deletedAt: null }, _sum: { paidAmount: true } }),
      prisma.financialHealthScore.findFirst({ where: { userId, monthId: month.id } }),
    ]);

    return {
      month: month.month,
      year: month.year,
      status: month.status,
      income: round2(Number(incomeAgg._sum.value ?? 0)),
      plannedExpenses: round2(Number(expensesAgg._sum.value ?? 0)),
      paidExpenses: round2(Number(paidAgg._sum.paidAmount ?? 0)),
      netBalance: round2(Number(incomeAgg._sum.value ?? 0) - Number(paidAgg._sum.paidAmount ?? 0)),
      healthScore: healthScore?.score ?? null,
    };
  }));

  // Saldo guardado no final de cada mês (calculado até a data de fechamento do mês ou hoje)
  const savingsNow = await savingsService.getCurrentBalance(userId);
  const savingsByMonth = monthsData.map((_, i) => {
    // Sem séries históricas de saldo guardado por mês armazenadas, usamos o
    // saldo atual como ponto final e deixamos os anteriores sem valor exato.
    // Melhoria futura: calcular balance_after até a data de encerramento de
    // cada mês via savings_transactions.transaction_date.
    if (i === monthsData.length - 1) return savingsNow;
    return null;
  });

  const enriched = monthsData.map((m, i) => ({ ...m, savingsBalance: savingsByMonth[i] }));

  // Dívida ativa total por mês — soma dos remaining_balance dos debts que
  // tinham parcelas geradas naquele mês (proxy: soma das despesas de
  // prioridade pendentes/pagas do mês).
  const debtByMonth = await Promise.all(slice.map(async (month) => {
    const agg = await prisma.expense.aggregate({
      where: { userId, monthId: month.id, type: 'priority', deletedAt: null },
      _sum: { value: true },
    });
    return round2(Number(agg._sum.value ?? 0));
  }));

  return {
    periods: slice.length,
    requestedPeriod: clampedPeriod,
    months: enriched.map((m, i) => ({ ...m, debtInstallments: debtByMonth[i] })),
    summary: buildSummary(enriched),
  };
}

function buildSummary(months) {
  if (months.length === 0) return {};
  const incomes = months.map((m) => m.income);
  const expenses = months.map((m) => m.paidExpenses);
  const avg = (arr) => round2(arr.reduce((a, b) => a + b, 0) / arr.length);
  return {
    avgIncome: avg(incomes),
    avgExpenses: avg(expenses),
    bestMonthNet: months.reduce((best, m) => m.netBalance > (best?.netBalance ?? -Infinity) ? m : best, null),
    worstMonthNet: months.reduce((worst, m) => m.netBalance < (worst?.netBalance ?? Infinity) ? m : worst, null),
    totalNetBalance: round2(months.reduce((sum, m) => sum + m.netBalance, 0)),
  };
}

module.exports = { getFinancialHistory };
