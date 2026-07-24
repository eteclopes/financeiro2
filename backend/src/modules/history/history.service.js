const prisma = require('../../config/prisma');
const monthsService = require('../months/months.service');
const { getAllMonthsChronological } = require('../_shared/financialMetrics');
const { getMonthFactsBatch, normalizeFacts } = require('../months/monthFacts.service');
const { round2 } = require('../../utils/math');

const PERIODS = { 3: 3, 6: 6, 12: 12 };

/**
 * Histórico financeiro dos últimos N meses.
 *
 * DUAS CORREÇÕES ESTRUTURAIS EM RELAÇÃO À VERSÃO ANTERIOR:
 *
 * 1. IMUTABILIDADE (era o furo da V19). Antes, esta tela recalculava
 *    TODOS os meses com os dados de hoje — inclusive os fechados. Uma
 *    receita lançada hoje com data retroativa mudava o "Histórico" de um
 *    mês encerrado, enquanto o Dashboard (que já usava snapshot) continuava
 *    mostrando o valor congelado: as duas telas discordavam. Agora ambas
 *    passam por `getMonthFacts`, que devolve o snapshot para mês fechado.
 *
 * 2. N+1. A versão anterior disparava, por mês da janela, 7 consultas mais
 *    dois `getBalanceAsOf` (6 agregações cada) — cerca de 100 consultas
 *    para 6 meses. Mês fechado agora não gera nenhuma consulta extra: o
 *    retrato já veio junto com a linha de `months`. Só meses abertos
 *    (normalmente um) ainda são calculados ao vivo.
 */
async function getFinancialHistory(userId, monthId, periodMonths = 6) {
  await monthsService.getMonthOrThrow(userId, monthId);
  const clampedPeriod = PERIODS[periodMonths] ?? 6;

  const allMonths = await getAllMonthsChronological(userId);
  const idx = allMonths.findIndex((month) => String(month.id) === String(monthId));
  const slice = allMonths.slice(Math.max(0, idx - clampedPeriod + 1), idx + 1);

  if (slice.length === 0) return { periods: 0, months: [], summary: {} };

  // Uma consulta para os scores e uma para as parcelas de dívida de TODOS
  // os meses da janela — em vez de duas por mês.
  const monthIds = slice.map((month) => month.id);
  const [factsList, healthScores, debtGroups] = await Promise.all([
    getMonthFactsBatch(userId, slice),
    prisma.financialHealthScore.findMany({
      where: { userId, monthId: { in: monthIds } },
      select: { monthId: true, score: true },
    }),
    prisma.expense.groupBy({
      by: ['monthId'],
      where: { userId, monthId: { in: monthIds }, type: 'priority', deletedAt: null },
      _sum: { value: true },
    }),
  ]);

  const scoreByMonth = new Map(healthScores.map((row) => [String(row.monthId), row.score]));
  const debtByMonth = new Map(debtGroups.map((row) => [String(row.monthId), Number(row._sum.value ?? 0)]));

  const months = slice.map((month, index) => {
    const facts = normalizeFacts(factsList[index]);
    return {
      month: month.month,
      year: month.year,
      status: month.status,
      // Indica à interface se aquele valor é histórico congelado ou vivo.
      source: facts.source,
      isFrozen: facts.isFrozen,
      income: round2(facts.incomeTotal),
      plannedExpenses: round2(facts.expensesPlanned),
      paidExpenses: round2(facts.expensesPaid),
      openingBalance: round2(facts.openingBalance),
      netBalance: round2(facts.currentBalance - facts.openingBalance),
      cumulativeBalance: round2(facts.currentBalance),
      savingsBalance: round2(facts.savingsBalance),
      // Patrimônio financeiro do mês (regra 8.5): saldo livre + reservas.
      // Transferir entre eles não altera este total.
      totalWealth: round2(facts.currentBalance + facts.savingsBalance),
      healthScore: scoreByMonth.get(String(month.id)) ?? null,
      debtInstallments: round2(debtByMonth.get(String(month.id)) ?? 0),
    };
  });

  return {
    periods: slice.length,
    requestedPeriod: clampedPeriod,
    months,
    summary: buildSummary(months),
  };
}

function buildSummary(months) {
  if (months.length === 0) return {};
  const incomes = months.map((month) => month.income);
  const expenses = months.map((month) => month.paidExpenses);
  const avg = (values) => round2(values.reduce((sum, value) => sum + value, 0) / values.length);
  return {
    avgIncome: avg(incomes),
    avgExpenses: avg(expenses),
    bestMonthNet: months.reduce((best, month) => (month.netBalance > (best?.netBalance ?? -Infinity) ? month : best), null),
    worstMonthNet: months.reduce((worst, month) => (month.netBalance < (worst?.netBalance ?? Infinity) ? month : worst), null),
    totalNetBalance: round2(months.reduce((sum, month) => sum + month.netBalance, 0)),
    endingBalance: months.at(-1)?.cumulativeBalance ?? 0,
    endingWealth: months.at(-1)?.totalWealth ?? 0,
    frozenMonths: months.filter((month) => month.isFrozen).length,
  };
}

module.exports = { getFinancialHistory, buildSummary };
