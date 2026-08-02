const prisma = require('../../config/prisma');
const { round2 } = require('../../utils/math');
const { todayUtcDate } = require('../../utils/dateTime');
const { getAvailableBalance } = require('../_shared/balance');
const { getAverageRecentExpense } = require('../_shared/financialMetrics');
const monthsService = require('../months/months.service');
const paymentsService = require('../payments/payments.service');
const savingsService = require('../savings/savings.service');

// Meses de gasto essencial que uma reserva saudável deve cobrir.
const TARGET_RESERVE_MONTHS = 3;
// Quanto da sobra vai, no máximo, para cada finalidade. São tetos, não metas:
// evitam sugerir que a pessoa jogue tudo num lugar só e fique sem respiro.
const MAX_SHARE_TO_RESERVE = 0.5;
const MAX_SHARE_TO_DEBT = 0.4;
const KEEP_GROWING_SHARE = 0.1;

/**
 * PLANO DO MÊS — diz, em reais, quanto dá para guardar, quanto vale adiantar
 * de dívida e quanto sobra livre para gastar.
 *
 * A diferença para uma sugestão em porcentagem é que aqui o cálculo parte do
 * dinheiro REAL: o saldo de hoje menos tudo que ainda tem de sair neste mês
 * (contas em aberto, parcelas e faturas que vencem). Sugerir "guarde 30%" sem
 * descontar os compromissos leva a pessoa a guardar dinheiro que já tem dono.
 */
async function getMonthlyPlan(userId, monthId) {
  const month = await monthsService.getMonthOrThrow(userId, monthId);

  const [balance, payables, reserveBalance, avgEssentials, activeDebts, activeGoals] = await Promise.all([
    getAvailableBalance(userId),
    paymentsService.getPayableItems(userId, monthId),
    savingsService.getCurrentBalance(userId),
    getAverageRecentExpense(userId, monthId, 3, 'paidAmount'),
    prisma.debt.findMany({ where: { userId, status: 'active' } }),
    prisma.goal.findMany({ where: { userId, status: 'active' }, include: { contributions: true } }),
  ]);

  const sum = (list) => round2((list || []).reduce((acc, i) => acc + Number(i.amount || 0), 0));
  const commitments = {
    bills: sum(payables.bills),
    debts: sum(payables.debts),
    invoices: sum(payables.invoices),
  };
  commitments.total = round2(commitments.bills + commitments.debts + commitments.invoices);

  const currentBalance = round2(balance);
  // O que realmente está livre: o que sobra depois de honrar o mês.
  const reallyFree = round2(Math.max(currentBalance - commitments.total, 0));

  // ── Reserva: quantos meses ela cobre hoje ──
  const essentials = round2(avgEssentials || 0);
  const coverageMonths = essentials > 0 ? round2(reserveBalance / essentials) : null;
  const reserveTarget = round2(essentials * TARGET_RESERVE_MONTHS);
  const reserveGap = round2(Math.max(reserveTarget - reserveBalance, 0));

  const totalDebt = round2(activeDebts.reduce((acc, d) => acc + Number(d.remainingBalance || 0), 0));

  const suggestions = [];
  let left = reallyFree;

  // 1) RESERVA — prioridade máxima enquanto não cobre os meses alvo.
  if (left > 0) {
    let amount;
    let reason;
    if (reserveGap > 0) {
      amount = round2(Math.min(reserveGap, left * MAX_SHARE_TO_RESERVE));
      const cobre = coverageMonths === null ? 'ainda sem histórico' : `${coverageMonths.toFixed(1)} mês(es)`;
      reason = `Sua reserva cobre ${cobre} de gastos e o ideal são ${TARGET_RESERVE_MONTHS}. Faltam ${reserveGap.toFixed(2)} para chegar lá.`;
    } else {
      amount = round2(left * KEEP_GROWING_SHARE);
      reason = `Sua reserva já cobre ${TARGET_RESERVE_MONTHS} meses. Guardar um pouco mantém o hábito sem apertar o mês.`;
    }
    if (amount >= 1) {
      suggestions.push({ key: 'reserve', label: 'Guardar na reserva', amount, reason, priority: reserveGap > 0 ? 'alta' : 'baixa' });
      left = round2(left - amount);
    }
  }

  // 2) DÍVIDA — adiantar reduz juros e encurta o compromisso.
  if (left > 0 && totalDebt > 0) {
    const amount = round2(Math.min(totalDebt, left * MAX_SHARE_TO_DEBT));
    if (amount >= 1) {
      suggestions.push({
        key: 'debt',
        label: 'Adiantar dívida',
        amount,
        reason: `Você ainda deve ${totalDebt.toFixed(2)}. Adiantar reduz o saldo devedor e encurta o prazo.`,
        priority: 'média',
      });
      left = round2(left - amount);
    }
  }

  // 3) METAS — quanto falta por mês para cada meta chegar no prazo.
  if (left > 0 && activeGoals.length > 0) {
    let neededPerMonth = 0;
    for (const goal of activeGoals) {
      const saved = goal.contributions.reduce(
        (acc, c) => acc + (c.type === 'refund' ? -Number(c.value) : Number(c.value)), 0
      );
      const missing = Math.max(Number(goal.targetValue) - saved, 0);
      if (missing <= 0) continue;
      const monthsLeft = goal.targetDate
        ? Math.max(monthsBetween(todayUtcDate(), new Date(goal.targetDate)), 1)
        : 12;
      neededPerMonth += missing / monthsLeft;
    }
    const amount = round2(Math.min(neededPerMonth, left));
    if (amount >= 1) {
      suggestions.push({
        key: 'goals',
        label: 'Aportar nas metas',
        amount,
        reason: `É o ritmo necessário para as ${activeGoals.length} meta(s) ativa(s) chegarem no prazo.`,
        priority: 'média',
      });
      left = round2(left - amount);
    }
  }

  // 4) LIVRE — o que sobra sem culpa.
  suggestions.push({
    key: 'free',
    label: 'Livre para gastar',
    amount: round2(Math.max(left, 0)),
    reason: 'Depois de honrar o mês, guardar e cuidar das metas, este valor é seu sem comprometer nada.',
    priority: 'baixa',
  });

  return {
    month: { id: String(month.id), month: month.month, year: month.year },
    currentBalance,
    commitments,
    reallyFree,
    reserve: {
      current: round2(reserveBalance),
      monthlyEssentials: essentials,
      coverageMonths,
      targetMonths: TARGET_RESERVE_MONTHS,
      target: reserveTarget,
      gap: reserveGap,
    },
    totalDebt,
    suggestions,
    warnings: buildWarnings({ currentBalance, commitments, reallyFree, coverageMonths, essentials, payables }),
  };
}

function monthsBetween(from, to) {
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
}

/**
 * Avisos que dependem do dinheiro do mês. Complementam os alertas já
 * existentes (atraso, gasto acima da receita, reserva baixa) em vez de
 * repeti-los: aqui o foco é a capacidade de honrar ESTE mês.
 */
function buildWarnings({ currentBalance, commitments, reallyFree, coverageMonths, essentials, payables }) {
  const warnings = [];

  if (commitments.total > currentBalance + 0.009) {
    warnings.push({
      code: 'MES_NAO_FECHA',
      level: 'error',
      title: 'O saldo não cobre os compromissos do mês',
      message: `Faltam ${round2(commitments.total - currentBalance).toFixed(2)} para pagar tudo que está em aberto.`,
    });
  } else if (reallyFree < essentials * 0.1 && essentials > 0) {
    warnings.push({
      code: 'MARGEM_APERTADA',
      level: 'warn',
      title: 'Margem apertada',
      message: 'Depois de pagar o mês sobra muito pouco. Evite novos compromissos agora.',
    });
  }

  const atrasadas = (payables.bills || []).filter((b) => b.fromPreviousMonth);
  if (atrasadas.length > 0) {
    const total = round2(atrasadas.reduce((acc, b) => acc + Number(b.amount || 0), 0));
    warnings.push({
      code: 'ATRASADAS_ACUMULANDO',
      level: 'warn',
      title: 'Contas de meses anteriores em aberto',
      message: `${atrasadas.length} conta(s) atrasada(s) somando ${total.toFixed(2)}. Quanto mais esperar, mais elas se acumulam.`,
    });
  }

  if (coverageMonths !== null && coverageMonths < 1) {
    warnings.push({
      code: 'RESERVA_MENOR_QUE_UM_MES',
      level: 'warn',
      title: 'Reserva cobre menos de um mês',
      message: `Hoje sua reserva cobre ${coverageMonths.toFixed(1)} mês de gastos. Um imprevisto viraria dívida.`,
    });
  }

  if (commitments.invoices > 0 && commitments.invoices > currentBalance) {
    warnings.push({
      code: 'FATURA_MAIOR_QUE_SALDO',
      level: 'warn',
      title: 'A fatura sozinha já passa do seu saldo',
      message: `Faturas em aberto somam ${commitments.invoices.toFixed(2)} e seu saldo é ${currentBalance.toFixed(2)}.`,
    });
  }

  return warnings;
}

module.exports = { getMonthlyPlan, TARGET_RESERVE_MONTHS };
