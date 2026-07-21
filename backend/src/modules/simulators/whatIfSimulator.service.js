const prisma = require('../../config/prisma');
const AppError = require('../../utils/AppError');
const monthsService = require('../months/months.service');
const { round2 } = require('../../utils/math');
const {
  getProjectionComponents,
  mergeComponentsIntoSeries,
  getSingleDebtSchedule,
} = require('../projections/projections.service');

/**
 * Cenários disponíveis. Cada um recebe os `components` brutos da projeção
 * baseline (ver projections.service.getProjectionComponents) e devolve uma
 * CÓPIA modificada, sem alterar dados reais — só altera arrays/números em
 * memória antes de passar para mergeComponentsIntoSeries. `components.months`
 * (lista de `{ month, year }`) é o que alinha cada posição dos arrays
 * `debtSchedule`/`cardSchedule` ao mês de calendário real correspondente.
 *
 * `input` esperado por tipo:
 *  pay_debt             → { debtId }                (quita a dívida HOJE, à vista)
 *  anticipate_installments → { debtId, amount }      (abate um valor extra no saldo devedor, hoje)
 *  save_monthly         → { amount }                 (reduz o net projetado todo mês — dinheiro vai para a poupança, não é gasto)
 *  reduce_category      → { amount }                 (reduz despesas fixas mensais — ver nota abaixo)
 *  cancel_subscription  → { amount }                 (reduz despesas fixas mensais)
 *  increase_income      → { amount }                 (aumenta a renda recorrente)
 *
 * NOTA sobre reduce_category/cancel_subscription: hoje os dois cenários
 * fazem exatamente a mesma coisa (reduzir `fixedExpenses` pelo valor
 * informado) — "reduce_category" não recebe nem um `categoryId`, então não
 * há, de fato, nenhuma categoria específica sendo considerada, nem
 * qualquer ligação com o histórico real de gastos daquela categoria
 * (ver categories.service.getBudgetStatus, que já existe e poderia
 * alimentar isso). Mantido assim de propósito nesta revisão — mudar o
 * formato do input alteraria o contrato da API e o formato já gravado em
 * `Simulation.inputJson` — mas é um ponto forte de melhoria futura,
 * detalhado no relatório de análise.
 */

async function applyScenario(userId, type, input, components) {
  const c = { ...components, debtSchedule: [...components.debtSchedule], cardSchedule: [...components.cardSchedule] };

  switch (type) {
    /**
     * Quitar a dívida À VISTA, hoje (mês índice 0): as parcelas futuras
     * (inclusive a do mês corrente, se ainda não foi gerada de outra
     * forma) somem do cronograma, e em troca entra um custo único, no mês
     * 0, igual ao saldo devedor inteiro — sem isso, quitar uma dívida
     * pareceria um ganho "de graça", sem nenhum custo, o que é
     * financeiramente incorreto e poderia levar a decisões ruins (ex.:
     * usar toda a reserva de emergência achando que "não custa nada").
     */
    case 'pay_debt': {
      const debt = await prisma.debt.findFirst({ where: { id: BigInt(input.debtId), userId, status: 'active' } });
      if (!debt) {
        throw new AppError('Dívida não encontrada ou não pertence a este usuário.', 404, 'DEBT_NOT_FOUND');
      }
      const debtSched = await getSingleDebtSchedule(debt, c.months);
      for (let i = 0; i < c.debtSchedule.length; i++) {
        c.debtSchedule[i] = round2(c.debtSchedule[i] - (debtSched[i] ?? 0));
      }
      c.debtSchedule[0] = round2(c.debtSchedule[0] + Number(debt.remainingBalance));
      break;
    }

    /**
     * Antecipar `amount` no saldo devedor hoje (sem quitar tudo): as
     * parcelas futuras diminuem (recalculadas sobre o saldo menor), mas o
     * valor antecipado sai do caixa AGORA — mesma razão do caso anterior,
     * "antecipar parcelas" só reduz despesa futura porque troca por uma
     * saída de caixa presente, que precisa aparecer no mês 0.
     */
    case 'anticipate_installments': {
      const debt = await prisma.debt.findFirst({ where: { id: BigInt(input.debtId), userId, status: 'active' } });
      if (!debt) {
        throw new AppError('Dívida não encontrada ou não pertence a este usuário.', 404, 'DEBT_NOT_FOUND');
      }
      const newBalance = round2(Math.max(Number(debt.remainingBalance) - Number(input.amount), 0));
      const debtSched = await getSingleDebtSchedule(debt, c.months);
      const newSched = await getSingleDebtSchedule(debt, c.months, newBalance);
      // O valor efetivamente antecipado é a diferença entre os dois
      // cronogramas JÁ CALCULADOS (soma total de um menos o outro) — não
      // `remainingBalance - newBalance` isolado. Os dois só coincidem
      // quando nenhum mês da janela ainda tem parcela real gerada; quando
      // o mês corrente já tem uma parcela real (o caso normal) e a
      // antecipação é grande o bastante para zerar o saldo, essa parcela
      // real continua aparecendo em `newSched` (é um fato consumado,
      // independente do saldo hipotético) — usar a subtração "ingênua"
      // cobraria essa mesma parcela duas vezes (uma vez embutida no total
      // antecipado, outra vez como parcela normal do mês).
      const sumSchedule = (arr) => arr.reduce((acc, v) => round2(acc + v), 0);
      const amountActuallyApplied = round2(sumSchedule(debtSched) - sumSchedule(newSched));
      for (let i = 0; i < c.debtSchedule.length; i++) {
        c.debtSchedule[i] = round2(c.debtSchedule[i] - (debtSched[i] ?? 0) + (newSched[i] ?? 0));
      }
      c.debtSchedule[0] = round2(c.debtSchedule[0] + amountActuallyApplied);
      break;
    }

    case 'save_monthly':
      // Guardar R$X/mês equivale a uma saída extra todo mês — reduz o net
      // projetado (o dinheiro não desaparece, vai para a poupança/reserva,
      // mas deixa de estar "livre" no fluxo de caixa mostrado aqui).
      c.fixedExpenses = round2(c.fixedExpenses + Number(input.amount));
      break;

    case 'reduce_category':
    case 'cancel_subscription':
      c.fixedExpenses = round2(Math.max(c.fixedExpenses - Number(input.amount), 0));
      break;

    case 'increase_income':
      c.recurringIncome = round2(c.recurringIncome + Number(input.amount));
      break;
  }

  return c;
}

/**
 * Roda o cenário em memória e compara com o baseline mês a mês.
 * Não persiste nada.
 */
async function runScenarioPreview(userId, monthId, type, input, monthsAhead = 12) {
  await monthsService.getMonthOrThrow(userId, monthId);
  const baseComponents = await getProjectionComponents(userId, monthId, monthsAhead);
  const scenarioComponents = await applyScenario(userId, type, input, baseComponents);

  const baseline = mergeComponentsIntoSeries(baseComponents);
  const scenario = mergeComponentsIntoSeries(scenarioComponents);

  const comparison = baseline.map((b, i) => {
    const s = scenario[i];
    return {
      month: b.month,
      year: b.year,
      baselineNet: b.netProjected,
      scenarioNet: s.netProjected,
      difference: round2(s.netProjected - b.netProjected),
      baselineCumulative: b.cumulativeNet,
      scenarioCumulative: s.cumulativeNet,
      cumulativeDifference: round2(s.cumulativeNet - b.cumulativeNet),
    };
  });

  const totalGain = round2(comparison[comparison.length - 1]?.cumulativeDifference ?? 0);
  const firstPositiveMonth = comparison.find((m) => m.cumulativeDifference > 0);

  return {
    type,
    input,
    monthsAhead,
    totalGain,
    firstPositiveMonth: firstPositiveMonth
      ? { month: firstPositiveMonth.month, year: firstPositiveMonth.year }
      : null,
    comparison,
  };
}

/**
 * Salva o cenário e seus resultados no banco para consulta futura.
 * Os dados financeiros reais NÃO são alterados em nenhum momento.
 */
async function saveSimulation(userId, monthId, { type, name, input, monthsAhead = 12 }) {
  const preview = await runScenarioPreview(userId, monthId, type, input, monthsAhead);

  return prisma.$transaction(async (tx) => {
    const simulation = await tx.simulation.create({
      data: {
        userId,
        type,
        name,
        inputJson: input,
        monthsAhead,
      },
    });

    await tx.simulationResult.createMany({
      data: preview.comparison.map((row, i) => ({
        simulationId: simulation.id,
        monthIndex: i,
        month: row.month,
        year: row.year,
        baselineNet: row.baselineNet,
        scenarioNet: row.scenarioNet,
        difference: row.difference,
      })),
    });

    return { simulation, preview };
  });
}

async function listSimulations(userId) {
  return prisma.simulation.findMany({
    where: { userId },
    include: { results: { orderBy: { monthIndex: 'asc' } } },
    orderBy: { createdAt: 'desc' },
  });
}

async function deleteSimulation(userId, simulationId) {
  const sim = await prisma.simulation.findFirst({ where: { id: simulationId, userId } });
  // Antes: `throw new Error(...)`. Como Error genérico não é `instanceof
  // AppError`, o errorHandler tratava isso como falha inesperada e
  // respondia 500 (e logava como erro real) em vez de 404 — para o caso
  // absolutamente esperado de "simulação não existe ou não é sua".
  if (!sim) throw new AppError('Simulação não encontrada.', 404, 'SIMULATION_NOT_FOUND');
  await prisma.simulation.delete({ where: { id: simulationId } });
}

module.exports = { runScenarioPreview, saveSimulation, listSimulations, deleteSimulation };
