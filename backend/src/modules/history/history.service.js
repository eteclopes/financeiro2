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


/**
 * EXTRATO DETALHADO DO MÊS — lançamento a lançamento, com o que foi pago,
 * quanto foi pago e quanto faltou.
 *
 * O histórico existente é agregado (totais por mês). Este extrato responde às
 * perguntas do dia a dia: "o que eu paguei?", "paguei quanto dessa parcela?",
 * "quanto ainda falta nela?".
 *
 * Para parcelas de dívida mostra o rótulo (3/12), o valor cheio da parcela, o
 * quanto foi efetivamente pago e o residual — que é justamente o valor que
 * rola para a parcela seguinte no pagamento parcial.
 */
async function getMonthStatement(userId, monthId) {
  const month = await monthsService.getMonthOrThrow(userId, monthId);
  const monthStart = new Date(Date.UTC(Number(month.year), Number(month.month) - 1, 1));
  const monthEnd = new Date(Date.UTC(Number(month.year), Number(month.month), 0, 23, 59, 59, 999));

  const [expenses, incomes, savings, goalContribs] = await Promise.all([
    prisma.expense.findMany({
      where: { userId, monthId, deletedAt: null },
      include: {
        category: true,
        debt: { select: { id: true, description: true, installmentsCount: true } },
        cardInvoice: { include: { card: { select: { name: true } } } },
      },
      orderBy: [{ dueDate: 'asc' }],
    }),
    prisma.income.findMany({
      where: { userId, monthId, deletedAt: null },
      include: { category: true },
      orderBy: [{ incomeDate: 'asc' }],
    }),
    // SavingsTransaction não guarda monthId: o recorte é por data.
    prisma.savingsTransaction.findMany({
      where: { userId, transactionDate: { gte: monthStart, lte: monthEnd } },
      include: { bucket: { select: { name: true } } },
      orderBy: [{ transactionDate: 'asc' }],
    }),
    prisma.goalContribution.findMany({
      where: { userId, monthId },
      include: { goal: { select: { name: true } } },
      orderBy: [{ contributionDate: 'asc' }],
    }),
  ]);

  const entries = [];

  for (const e of expenses) {
    const full = Number(e.value);
    const paid = Number(e.paidAmount ?? 0);
    const remaining = round2(Math.max(full - paid, 0));
    const isDebt = e.type === 'priority';

    entries.push({
      kind: 'expense',
      subtype: e.type,
      id: String(e.id),
      date: e.paidAt ?? e.dueDate,
      dueDate: e.dueDate,
      paidAt: e.paidAt ?? null,
      description: e.description,
      category: e.category?.name ?? null,
      status: e.status,
      paymentMethod: e.paymentMethod ?? null,
      // Valores: o combinado, o que saiu e o que ficou faltando.
      installmentValue: round2(full),
      paidAmount: round2(paid),
      remaining,
      isPartial: paid > 0 && remaining > 0.009,
      // Contexto de dívida e de cartão.
      debt: isDebt && e.debt ? { id: String(e.debt.id), name: e.debt.description } : null,
      card: e.cardInvoice?.card?.name ?? null,
      invoiceRef: e.cardInvoice
        ? { month: e.cardInvoice.referenceMonth, year: e.cardInvoice.referenceYear }
        : null,
    });
  }

  for (const i of incomes) {
    entries.push({
      kind: 'income',
      id: String(i.id),
      date: i.incomeDate,
      description: i.description,
      category: i.category?.name ?? null,
      amount: round2(Number(i.value)),
      origin: i.origin ?? null,
    });
  }

  for (const t of savings) {
    entries.push({
      kind: t.type === 'withdraw' ? 'savings_withdraw' : 'savings_deposit',
      id: String(t.id),
      date: t.transactionDate,
      description: t.observation || (t.type === 'withdraw' ? 'Resgate da reserva' : 'Depósito na reserva'),
      bucket: t.bucket?.name ?? null,
      amount: round2(Number(t.value)),
      origin: t.origin ?? null,
    });
  }

  for (const c of goalContribs) {
    entries.push({
      kind: c.type === 'refund' ? 'goal_refund' : 'goal_contribution',
      id: String(c.id),
      date: c.contributionDate,
      description: c.goal?.name ?? 'Meta',
      amount: round2(Number(c.value)),
    });
  }

  entries.sort((a, b) => new Date(a.date) - new Date(b.date));

  const sumBy = (fn) => round2(entries.reduce((acc, e) => acc + (fn(e) || 0), 0));
  const totals = {
    received: sumBy((e) => (e.kind === 'income' ? e.amount : 0)),
    paid: sumBy((e) => (e.kind === 'expense' ? e.paidAmount : 0)),
    stillOwed: sumBy((e) => (e.kind === 'expense' ? e.remaining : 0)),
    savedToReserve: sumBy((e) => (e.kind === 'savings_deposit' ? e.amount : 0)),
    withdrawnFromReserve: sumBy((e) => (e.kind === 'savings_withdraw' ? e.amount : 0)),
    contributedToGoals: sumBy((e) => (e.kind === 'goal_contribution' ? e.amount : 0)),
    partialCount: entries.filter((e) => e.isPartial).length,
  };

  return { month: { id: String(month.id), month: month.month, year: month.year, status: month.status }, entries, totals };
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

module.exports = { getFinancialHistory, getMonthStatement, buildSummary };
