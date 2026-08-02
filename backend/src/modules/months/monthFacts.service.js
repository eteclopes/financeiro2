const prisma = require('../../config/prisma');
const { buildMonthSnapshot, validSnapshot, SNAPSHOT_VERSION } = require('./monthSnapshot.service');

/**
 * FONTE ÚNICA DE VERDADE dos valores agregados de um mês.
 *
 * Antes, cada tela recalculava os totais do seu jeito: o Dashboard usava o
 * snapshot congelado, mas Histórico, Saúde Financeira e Análise
 * Comportamental recalculavam meses FECHADOS com os dados de hoje. Um
 * lançamento retroativo mudava o passado em três telas e não mudava na
 * quarta — a imutabilidade prometida pela V19 existia só no Dashboard.
 *
 * Regra agora:
 *   mês fechado + snapshot válido -> snapshot (congelado, nunca recalculado)
 *   qualquer outro caso           -> cálculo ao vivo
 *
 * Como um mês fechado devolve apenas a leitura de um JSON já carregado,
 * isto também elimina o N+1 do Histórico: uma janela de 6 meses deixa de
 * disparar ~100 queries.
 */
async function getMonthFacts(userId, month, client = prisma) {
  if (month.status === 'closed' && validSnapshot(month)) {
    return {
      ...month.financialSnapshot,
      source: 'snapshot',
      snapshotVersion: Number(month.snapshotVersion ?? SNAPSHOT_VERSION),
      isFrozen: true,
    };
  }

  const live = await buildMonthSnapshot(userId, month, client);
  return {
    ...live,
    source: 'live',
    // Mês fechado sem snapshot válido é uma anomalia operacional: os números
    // são calculados, mas a tela precisa poder avisar que não estão congelados.
    isFrozen: false,
    ...(month.status === 'closed' ? { missingSnapshot: true } : {}),
  };
}

/**
 * Versão em lote: carrega os meses com o snapshot embutido e resolve todos
 * de uma vez. Meses fechados não geram nenhuma query adicional.
 */
async function getMonthFactsBatch(userId, months, client = prisma) {
  return Promise.all(months.map((month) => getMonthFacts(userId, month, client)));
}

/** Campos que precisam existir para o Dashboard não quebrar com JSON antigo. */
const FACT_DEFAULTS = Object.freeze({
  openingBalance: 0,
  incomeTotal: 0,
  expensesPlanned: 0,
  expensesPaid: 0,
  outstanding: 0,
  currentBalance: 0,
  projectedBalance: 0,
  savingsBalance: 0,
  savingsNet: 0,
  goalNet: 0,
  goalsBalance: 0,
  physicalCash: 0,
  digitalCash: 0,
  totalActiveDebt: 0,
  activeDebtsCount: 0,
  remainingInstallments: 0,
  pendingExpensesCount: 0,
  financialHealthScore: null,
});

/**
 * Blindagem contra snapshot antigo, incompleto ou corrompido: nenhuma tela
 * deve quebrar por causa de um campo ausente num JSON gravado por uma
 * versão anterior do produto.
 */
function normalizeFacts(facts) {
  const safe = { ...FACT_DEFAULTS };
  if (facts && typeof facts === 'object') {
    for (const key of Object.keys(FACT_DEFAULTS)) {
      const value = Number(facts[key]);
      if (Number.isFinite(value)) safe[key] = value;
    }
  }
  const rawHealth = facts?.financialHealthScore;
  safe.financialHealthScore = rawHealth == null || !Number.isFinite(Number(rawHealth))
    ? null
    : Number(rawHealth);
  return {
    ...safe,
    source: facts?.source ?? 'live',
    isFrozen: Boolean(facts?.isFrozen),
    reconstructed: Boolean(facts?.reconstructed),
    capturedAt: facts?.capturedAt ?? null,
  };
}

module.exports = { getMonthFacts, getMonthFactsBatch, normalizeFacts, FACT_DEFAULTS };
