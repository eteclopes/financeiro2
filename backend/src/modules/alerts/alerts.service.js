const prisma = require('../../config/prisma');
const monthsService = require('../months/months.service');
const savingsService = require('../savings/savings.service');
const cardsService = require('../cards/cards.service');
const { getAllMonthsChronological } = require('../_shared/financialMetrics');

/**
 * Cada regra é uma função pura: recebe o contexto de métricas do mês e
 * devolve um alerta (ou vários, no caso de regras por cartão/meta) ou nada.
 * `type` precisa ser estável e único por "assunto" do alerta — é a chave
 * usada para idempotência (upsert) e para decidir o que foi resolvido.
 */

function pct(value) {
  return Math.round(value * 100);
}

async function gatherContext(userId, monthId) {
  const month = await monthsService.getMonthOrThrow(userId, monthId);

  const allMonths = await getAllMonthsChronological(userId);
  const idx = allMonths.findIndex((m) => m.id === monthId);
  const previousMonth = idx > 0 ? allMonths[idx - 1] : null;

  const now = new Date();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [
    incomeAgg,
    expensesAgg,
    lateCount,
    previousIncomeAgg,
    previousExpensesAgg,
    savingsBalance,
    cardsRaw,
    activeGoals,
    debtsCreatedThisMonthAgg,
    paidTowardDebtThisMonthAgg,
    upcomingBills,
  ] = await Promise.all([
    prisma.income.aggregate({ where: { userId, monthId }, _sum: { value: true } }),
    prisma.expense.aggregate({ where: { userId, monthId, deletedAt: null }, _sum: { value: true } }),
    prisma.expense.count({ where: { userId, monthId, deletedAt: null, status: 'late' } }),
    previousMonth
      ? prisma.income.aggregate({ where: { userId, monthId: previousMonth.id }, _sum: { value: true } })
      : Promise.resolve({ _sum: { value: 0 } }),
    previousMonth
      ? prisma.expense.aggregate({
          where: { userId, monthId: previousMonth.id, deletedAt: null },
          _sum: { value: true },
        })
      : Promise.resolve({ _sum: { value: 0 } }),
    savingsService.getCurrentBalance(userId),
    prisma.card.findMany({ where: { userId, active: true } }),
    prisma.goal.findMany({ where: { userId, status: 'active' }, include: { contributions: true } }),
    prisma.debt.aggregate({
      where: { userId, createdAt: { gte: new Date(Date.UTC(month.year, month.month - 1, 1)) } },
      _sum: { totalValue: true },
    }),
    prisma.expense.aggregate({
      where: { userId, monthId, type: 'priority', deletedAt: null },
      _sum: { paidAmount: true },
    }),
    // Contas a vencer nos próximos 7 dias — busca por DATA REAL DE
    // CALENDÁRIO (não por mês/`monthId`), porque uma conta "perto de
    // vencer" é uma pergunta sobre o relógio de verdade, não sobre qual
    // mês está selecionado na tela: perto da virada do mês, uma conta do
    // mês seguinte pode já estar a poucos dias de vencer. Não inclui
    // `status: 'late'` de propósito — atraso já tem seu próprio alerta
    // (`late_bills` abaixo); aqui é só o que ainda não venceu.
    prisma.expense.findMany({
      where: {
        userId,
        deletedAt: null,
        status: { in: ['pending', 'partial'] },
        dueDate: { gte: now, lte: sevenDaysFromNow },
      },
      orderBy: { dueDate: 'asc' },
      select: { id: true, description: true, value: true, dueDate: true },
    }),
  ]);

  const usedLimitByCard = await cardsService.computeUsedLimitsByCard(cardsRaw.map((c) => c.id));
  const cards = cardsRaw.map((card) => ({
    id: card.id,
    name: card.name,
    limitValue: Number(card.limitValue),
    usedLimit: usedLimitByCard.get(String(card.id)) ?? 0,
  }));

  const goals = activeGoals.map((goal) => {
    const contributionDates = goal.contributions
      .filter((c) => c.type === 'contribution')
      .map((c) => c.contributionDate);
    const lastContributionDate =
      contributionDates.length > 0 ? new Date(Math.max(...contributionDates.map((d) => d.getTime()))) : null;
    return { id: goal.id, name: goal.name, createdAt: goal.createdAt, lastContributionDate };
  });

  // últimos 3 meses de despesa paga, para "reserva muito baixa"
  const recentIds = allMonths.slice(Math.max(0, idx - 2), idx + 1).map((m) => m.id);
  const recentExpensesAgg = await prisma.expense.aggregate({
    where: { userId, monthId: { in: recentIds }, deletedAt: null },
    _sum: { paidAmount: true },
  });
  const avgMonthlyExpense = recentIds.length > 0 ? Number(recentExpensesAgg._sum.paidAmount ?? 0) / recentIds.length : 0;

  return {
    incomeTotal: Number(incomeAgg._sum.value ?? 0),
    expensesPlanned: Number(expensesAgg._sum.value ?? 0),
    lateCount,
    previousIncome: Number(previousIncomeAgg._sum.value ?? 0),
    previousExpenses: Number(previousExpensesAgg._sum.value ?? 0),
    savingsBalance,
    avgMonthlyExpense,
    cards,
    goals,
    newDebtThisMonth: Number(debtsCreatedThisMonthAgg._sum.totalValue ?? 0),
    paidTowardDebtThisMonth: Number(paidTowardDebtThisMonthAgg._sum.paidAmount ?? 0),
    upcomingBills: upcomingBills.map((e) => ({
      id: e.id,
      description: e.description,
      value: Number(e.value),
      dueDate: e.dueDate,
      daysUntilDue: Math.ceil((e.dueDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
    })),
  };
}

function evaluateRules(ctx) {
  const alerts = [];

  // Cartões — só dispara o mais severo por cartão (crítico substitui aviso)
  for (const card of ctx.cards) {
    if (card.limitValue <= 0) continue;
    const utilization = card.usedLimit / card.limitValue;
    if (utilization >= 0.95) {
      alerts.push({
        type: `card_limit:${card.id}`,
        severity: 'critical',
        message: `Cartão ${card.name} está usando ${pct(utilization)}% do limite.`,
      });
    } else if (utilization >= 0.8) {
      alerts.push({
        type: `card_limit:${card.id}`,
        severity: 'warning',
        message: `Cartão ${card.name} está usando ${pct(utilization)}% do limite.`,
      });
    }
  }

  // Receita caiu vs. mês anterior (queda de 15%+)
  if (ctx.previousIncome > 0) {
    const drop = (ctx.previousIncome - ctx.incomeTotal) / ctx.previousIncome;
    if (drop >= 0.15) {
      alerts.push({
        type: 'income_drop',
        severity: 'warning',
        message: `Sua receita caiu ${pct(drop)}% em relação ao mês anterior.`,
      });
    }
  }

  // Gastos aumentaram 20%+ vs. mês anterior
  if (ctx.previousExpenses > 0) {
    const increase = (ctx.expensesPlanned - ctx.previousExpenses) / ctx.previousExpenses;
    if (increase >= 0.2) {
      alerts.push({
        type: 'expense_spike',
        severity: 'warning',
        message: `Seus gastos aumentaram ${pct(increase)}% em relação ao mês anterior.`,
      });
    }
  }

  // Metas sem aporte há mais de 60 dias
  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
  for (const goal of ctx.goals) {
    const reference = goal.lastContributionDate ?? goal.createdAt;
    if (reference < sixtyDaysAgo) {
      alerts.push({
        type: `goal_stalled:${goal.id}`,
        severity: 'info',
        message: `Meta "${goal.name}" está sem aportes há mais de 60 dias.`,
      });
    }
  }

  // Dívida crescendo: dívida nova criada no mês supera o que foi pago em
  // dívidas no mesmo período (proxy matemático simples, documentado).
  if (ctx.newDebtThisMonth > ctx.paidTowardDebtThisMonth) {
    alerts.push({
      type: 'debt_growing',
      severity: 'warning',
      message: 'Novas dívidas assumidas este mês superam o valor pago em dívidas existentes.',
    });
  }

  // Despesas maiores que receita / margem baixa (mutuamente exclusivos)
  if (ctx.incomeTotal > 0 && ctx.expensesPlanned > ctx.incomeTotal) {
    alerts.push({
      type: 'expenses_exceed_income',
      severity: 'critical',
      message: 'As despesas previstas deste mês superam a receita.',
    });
  } else if (ctx.incomeTotal > 0) {
    const margin = (ctx.incomeTotal - ctx.expensesPlanned) / ctx.incomeTotal;
    if (margin < 0.1) {
      alerts.push({
        type: 'low_margin',
        severity: 'warning',
        message: `Sua margem financeira está baixa (${pct(margin)}% da receita).`,
      });
    }
  }

  // Contas atrasadas
  if (ctx.lateCount > 0) {
    alerts.push({
      type: 'late_bills',
      severity: ctx.lateCount >= 3 ? 'critical' : 'warning',
      message: `Você tem ${ctx.lateCount} conta(s) atrasada(s).`,
    });
  }

  // Contas a vencer nos próximos 7 dias (ainda não atrasadas). Severidade
  // escala com a urgência: se a mais próxima vence em até 2 dias, é
  // 'critical' (mesmo padrão de "cartão perto do limite" acima); senão
  // 'warning'. Cita a conta mais próxima pelo nome para ser acionável,
  // igual o alerta de cartão cita o cartão pelo nome.
  if (ctx.upcomingBills.length > 0) {
    const nearest = ctx.upcomingBills[0];
    const total = ctx.upcomingBills.reduce((sum, b) => sum + b.value, 0);
    const urgent = nearest.daysUntilDue <= 2;
    const dueLabel = nearest.daysUntilDue <= 0 ? 'hoje' : nearest.daysUntilDue === 1 ? 'amanhã' : `em ${nearest.daysUntilDue} dias`;
    const extra = ctx.upcomingBills.length > 1 ? ` (+${ctx.upcomingBills.length - 1} outra(s), total R$ ${total.toFixed(2)})` : '';
    alerts.push({
      type: 'upcoming_bills',
      severity: urgent ? 'critical' : 'warning',
      message: `"${nearest.description}" vence ${dueLabel} (R$ ${nearest.value.toFixed(2)})${extra}.`,
    });
  }

  // Reserva financeira muito baixa (menos de 1 mês de despesas cobertas)
  if (ctx.avgMonthlyExpense > 0) {
    const reserveMonths = ctx.savingsBalance / ctx.avgMonthlyExpense;
    if (reserveMonths < 1) {
      alerts.push({
        type: 'low_reserve',
        severity: reserveMonths < 0.25 ? 'critical' : 'warning',
        message: `Sua reserva financeira cobre apenas ${reserveMonths.toFixed(1)} mês(es) de despesas.`,
      });
    }
  }

  return alerts;
}

/**
 * Recalcula, resolve automaticamente alertas que pararam de ser válidos
 * (sem apagar — `resolved_at` preserva o histórico) e faz upsert dos que
 * continuam/passaram a ser válidos. Idempotente: chamar repetidamente no
 * mesmo estado não cria linhas duplicadas (chave única user+mês+tipo).
 */
async function refreshAlerts(userId, monthId) {
  const ctx = await gatherContext(userId, monthId);
  const triggered = evaluateRules(ctx);
  const triggeredTypes = new Set(triggered.map((a) => a.type));

  return prisma.$transaction(async (tx) => {
    const existingActive = await tx.alert.findMany({ where: { userId, monthId, resolvedAt: null } });

    await Promise.all(
      existingActive
        .filter((a) => !triggeredTypes.has(a.type))
        .map((a) => tx.alert.update({ where: { id: a.id }, data: { resolvedAt: new Date() } }))
    );

    await Promise.all(
      triggered.map((a) =>
        tx.alert.upsert({
          where: { userId_monthId_type: { userId, monthId, type: a.type } },
          update: { severity: a.severity, message: a.message, resolvedAt: null },
          create: { userId, monthId, type: a.type, severity: a.severity, message: a.message },
        })
      )
    );

    return tx.alert.findMany({
      where: { userId, monthId },
      orderBy: [{ resolvedAt: 'asc' }, { createdAt: 'desc' }],
    });
  });
}

module.exports = { refreshAlerts };
