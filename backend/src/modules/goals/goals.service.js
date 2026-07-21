const prisma = require('../../config/prisma');
const AppError = require('../../utils/AppError');
const monthsService = require('../months/months.service');
const { recordAuditLog } = require('../auditLog/auditLog.service');
const { round2 } = require('../../utils/math');
const { assertSufficientBalance, lockUserBalance } = require('../_shared/balance');
const { todayUtcDate, isFutureDate } = require('../../utils/dateTime');

function computeProgress(contributions) {
  return contributions.reduce((total, c) => {
    return round2(total + (c.type === 'contribution' ? Number(c.value) : -Number(c.value)));
  }, 0);
}

/**
 * "Guardando R$X por mês você atinge a meta em N meses" — projeção simples,
 * não um compromisso. Sem aportes hipotéticos informados, usa a média dos
 * aportes reais dos últimos 3 meses como estimativa de ritmo atual.
 */
function estimateMonthsToComplete(remaining, monthlyAmount) {
  if (remaining <= 0) return 0;
  if (!monthlyAmount || monthlyAmount <= 0) return null;
  return Math.ceil(remaining / monthlyAmount);
}

async function listGoals(userId) {
  const goals = await prisma.goal.findMany({
    where: { userId },
    include: { contributions: true },
    orderBy: { createdAt: 'desc' },
  });

  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  return goals.map((goal) => {
    const progress = computeProgress(goal.contributions);
    const remaining = round2(Math.max(Number(goal.targetValue) - progress, 0));

    const recentContributions = goal.contributions.filter(
      (c) => c.type === 'contribution' && c.contributionDate >= threeMonthsAgo
    );
    const recentTotal = recentContributions.reduce((sum, c) => sum + Number(c.value), 0);
    const averageMonthly = recentContributions.length > 0 ? round2(recentTotal / 3) : 0;

    return {
      ...goal,
      contributions: undefined,
      progress,
      remaining,
      percentage: Number(goal.targetValue) > 0 ? round2((progress / Number(goal.targetValue)) * 100) : 0,
      estimatedMonthsAtCurrentPace: estimateMonthsToComplete(remaining, averageMonthly),
    };
  });
}

async function createGoal(userId, payload) {
  const goal = await prisma.goal.create({ data: { userId, ...payload, status: 'active' } });
  await recordAuditLog(userId, 'goal', goal.id, 'create', { newValue: goal });
  return goal;
}

async function getOwnedGoalOrThrow(userId, goalId) {
  const goal = await prisma.goal.findFirst({ where: { id: goalId, userId } });
  if (!goal) {
    throw new AppError('Meta não encontrada.', 404, 'GOAL_NOT_FOUND');
  }
  return goal;
}

async function updateGoal(userId, goalId, payload) {
  const before = await getOwnedGoalOrThrow(userId, goalId);
  const updated = await prisma.goal.update({ where: { id: goalId }, data: payload });
  await recordAuditLog(userId, 'goal', goalId, 'update', { oldValue: before, newValue: updated });
  return updated;
}

async function contribute(userId, goalId, { monthId, value, date }) {
  if (isFutureDate(date)) {
    throw new AppError('Não é possível registrar um aporte com data futura.', 422, 'FUTURE_TRANSACTION_DATE');
  }
  const month = await monthsService.getMonthOrThrow(userId, monthId);
  if (date.getUTCMonth() + 1 !== month.month || date.getUTCFullYear() !== month.year) {
    throw new AppError('A data do aporte não pertence ao mês selecionado.', 422, 'DATE_OUTSIDE_MONTH');
  }

  return prisma.$transaction(async (tx) => {
    await lockUserBalance(tx, userId);
    const goal = await tx.goal.findFirst({ where: { id: goalId, userId } });
    if (!goal) throw new AppError('Meta não encontrada.', 404, 'GOAL_NOT_FOUND');
    if (goal.status !== 'active') {
      throw new AppError('Esta meta não está ativa.', 409, 'GOAL_NOT_ACTIVE');
    }
    await assertSufficientBalance(userId, value, tx);
    return tx.goalContribution.create({
      data: { goalId, monthId, value, type: 'contribution', contributionDate: date },
    });
  });
}

async function cancelGoal(userId, goalId, { refundContributions, monthId }) {
  const goal = await getOwnedGoalOrThrow(userId, goalId);
  if (goal.status === 'cancelled') {
    throw new AppError('Esta meta já está cancelada.', 409, 'GOAL_ALREADY_CANCELLED');
  }

  return prisma.$transaction(async (tx) => {
    await lockUserBalance(tx, userId);
    const currentGoal = await tx.goal.findFirst({ where: { id: goalId, userId } });
    if (!currentGoal) throw new AppError('Meta não encontrada.', 404, 'GOAL_NOT_FOUND');
    if (currentGoal.status === 'cancelled') {
      throw new AppError('Esta meta já está cancelada.', 409, 'GOAL_ALREADY_CANCELLED');
    }

    const updatedGoal = await tx.goal.update({ where: { id: goalId }, data: { status: 'cancelled' } });

    if (!refundContributions) {
      return { goal: updatedGoal, refund: null };
    }

    const contributions = await tx.goalContribution.findMany({ where: { goalId } });
    const totalContributed = computeProgress(contributions);
    if (totalContributed <= 0) {
      return { goal: updatedGoal, refund: null };
    }

    // A devolução SEMPRE cai no mês corrente (ou no informado), nunca no(s)
    // mês(es) de origem dos aportes — reabrir um mês passado para refletir
    // a devolução violaria a regra de histórico imutável.
    const targetMonth = monthId
      ? await monthsService.getMonthOrThrow(userId, monthId, tx)
      : await monthsService.getCurrentMonth(userId, tx);

    const refund = await tx.goalContribution.create({
      data: {
        goalId,
        monthId: targetMonth.id,
        value: totalContributed,
        type: 'refund',
        contributionDate: todayUtcDate(),
      },
    });

    return { goal: updatedGoal, refund };
  }).then(async (result) => {
    await recordAuditLog(userId, 'goal', goalId, 'cancel', { oldValue: goal, newValue: result.goal });
    return result;
  });
}

module.exports = { listGoals, createGoal, updateGoal, contribute, cancelGoal, getOwnedGoalOrThrow };
