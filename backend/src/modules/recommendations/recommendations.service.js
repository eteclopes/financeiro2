const prisma = require('../../config/prisma');
const monthsService = require('../months/months.service');
const savingsService = require('../savings/savings.service');
const { getAverageRecentIncome, getAverageRecentExpense } = require('../_shared/financialMetrics');
const { addMonths } = require('../../utils/monthMath');
const { round2 } = require('../../utils/math');

/**
 * Todas as recomendações são derivadas de fórmulas explicáveis aplicadas
 * sobre os dados reais do usuário — sem IA, sem heurísticas opacas.
 * Cada item de retorno carrega o cálculo que gerou a recomendação.
 */
async function generateRecommendations(userId, monthId) {
  await monthsService.getMonthOrThrow(userId, monthId);

  const [
    avgIncome,
    avgExpense,
    savingsBalance,
    activeDebts,
    activeGoals,
  ] = await Promise.all([
    getAverageRecentIncome(userId, monthId, 3),
    getAverageRecentExpense(userId, monthId, 3, 'paidAmount'),
    savingsService.getCurrentBalance(userId),
    prisma.debt.findMany({ where: { userId, status: 'active' }, include: { _count: { select: { expenses: true } } } }),
    prisma.goal.findMany({ where: { userId, status: 'active' }, include: { contributions: true } }),
  ]);

  const recommendations = [];
  const projectedSurplus = round2(avgIncome - avgExpense);

  // 1. Pode aumentar reserva mensal?
  if (projectedSurplus > 50) {
    const suggestedSaving = round2(projectedSurplus * 0.3);
    recommendations.push({
      type: 'increase_savings',
      priority: 'medium',
      title: 'Aumente sua reserva financeira',
      description: `Você pode guardar R$ ${suggestedSaving.toFixed(2)} por mês e ainda manter uma margem confortável.`,
      calculation: `Sobra média (${round2(projectedSurplus).toFixed(2)}) × 30% = ${suggestedSaving.toFixed(2)}/mês`,
    });
  }

  // 2. Dívida quitável com reserva atual?
  const TARGET_RESERVE_MONTHS = 3;
  const safeToUse = round2(Math.max(savingsBalance - avgExpense * TARGET_RESERVE_MONTHS, 0));
  for (const debt of activeDebts) {
    if (safeToUse >= Number(debt.remainingBalance) && Number(debt.remainingBalance) > 0) {
      const interestSaved = round2(Number(debt.installmentValue) * (debt.installmentsCount - debt._count.expenses));
      recommendations.push({
        type: 'pay_debt_with_savings',
        priority: 'high',
        title: `Quite a dívida "${debt.description}" com a reserva`,
        description: `Usar R$ ${Number(debt.remainingBalance).toFixed(2)} da reserva quita esta dívida e libera R$ ${Number(debt.installmentValue).toFixed(2)}/mês.`,
        calculation: `Reserva disponível (${safeToUse.toFixed(2)}) ≥ saldo devedor (${Number(debt.remainingBalance).toFixed(2)}) — reserva segura mantida por ${TARGET_RESERVE_MONTHS} meses.`,
        debtId: String(debt.id),
        amountNeeded: Number(debt.remainingBalance),
        monthlyRelief: Number(debt.installmentValue),
        estimatedSavings: interestSaved,
      });
    }
  }

  // 3. Melhor parcelamento sugerido (baseado no surplus médio)
  if (projectedSurplus > 0) {
    const installments = Math.ceil(projectedSurplus * 0.2) > 0
      ? Math.min(Math.ceil(100 / (projectedSurplus * 0.2)), 12)
      : null;
    if (installments && installments > 1) {
      recommendations.push({
        type: 'best_installment',
        priority: 'low',
        title: 'Parcelamento recomendado para novas compras',
        description: `Com sua margem atual, o melhor parcelamento para novas compras é até ${installments}x.`,
        calculation: `Margem livre para parcelar: 20% de ${round2(projectedSurplus).toFixed(2)} = ${round2(projectedSurplus * 0.2).toFixed(2)}/mês.`,
        suggestedInstallments: installments,
      });
    }
  }

  // 4. Meta acelerada: quanto economizar para atingir X meses antes?
  for (const goal of activeGoals) {
    const progress = goal.contributions.reduce(
      (sum, c) => sum + (c.type === 'contribution' ? Number(c.value) : -Number(c.value)), 0
    );
    const remaining = round2(Math.max(Number(goal.targetValue) - progress, 0));
    if (remaining <= 0) continue;

    const recentContributions = goal.contributions.filter((c) => c.type === 'contribution');
    const avgContrib = recentContributions.length > 0
      ? recentContributions.reduce((s, c) => s + Number(c.value), 0) / recentContributions.length
      : 0;

    const currentMonths = avgContrib > 0 ? Math.ceil(remaining / avgContrib) : null;

    // Sugerir incremento de 20% no aporte se o surplus permitir
    if (projectedSurplus > 50 && avgContrib > 0) {
      const boostedContrib = round2(avgContrib * 1.2);
      const boostExtra = round2(boostedContrib - avgContrib);
      if (boostExtra <= projectedSurplus) {
        const boostedMonths = Math.ceil(remaining / boostedContrib);
        const gain = currentMonths ? currentMonths - boostedMonths : null;
        if (gain && gain > 0) {
          recommendations.push({
            type: 'accelerate_goal',
            priority: 'medium',
            title: `Alcance "${goal.name}" ${gain} mês(es) antes`,
            description: `Aumentando o aporte de R$ ${avgContrib.toFixed(2)} para R$ ${boostedContrib.toFixed(2)}/mês você atinge a meta ${gain} meses mais cedo.`,
            calculation: `Aporte atual: ${avgContrib.toFixed(2)} → ${Math.ceil(remaining / avgContrib)} meses. Aporte boosted: ${boostedContrib.toFixed(2)} → ${boostedMonths} meses.`,
            goalId: String(goal.id),
            currentAverageContribution: avgContrib,
            suggestedContribution: boostedContrib,
            monthsGained: gain,
          });
        }
      }
    }
  }

  // 5. Reserva abaixo de 3 meses de despesa → guardar X para normalizar em 6 meses
  if (avgExpense > 0) {
    const reserveMonths = savingsBalance / avgExpense;
    if (reserveMonths < 3 && projectedSurplus > 0) {
      const target = round2(avgExpense * 3);
      const gap = round2(Math.max(target - savingsBalance, 0));
      const suggestedMonthly = round2(Math.min(gap / 6, projectedSurplus * 0.5));
      if (suggestedMonthly > 10) {
        recommendations.push({
          type: 'build_reserve',
          priority: 'high',
          title: 'Fortaleça sua reserva de emergência',
          description: `Guardando R$ ${suggestedMonthly.toFixed(2)}/mês você atinge 3 meses de reserva em 6 meses.`,
          calculation: `Meta (${target.toFixed(2)}) − saldo atual (${savingsBalance.toFixed(2)}) = ${gap.toFixed(2)} ÷ 6 meses.`,
          suggestedMonthly,
          targetReserve: target,
        });
      }
    }
  }

  return { recommendations };
}

module.exports = { generateRecommendations };
