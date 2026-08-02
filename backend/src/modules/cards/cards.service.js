const prisma = require('../../config/prisma');
const AppError = require('../../utils/AppError');
const { recordAuditLog } = require('../auditLog/auditLog.service');
const { getUserPlan } = require('../plans/plans.service');
const { getRequestWorkspaceType } = require('../../utils/requestContext');

// Status que ainda "consomem" limite — uma vez paga, a parcela libera limite,
// mesmo que o cartão físico real só libere no ciclo seguinte (simplificação
// deliberada documentada na auditoria final).
const OPEN_EXPENSE_STATUSES = ['pending', 'partial', 'late'];

// client opcional (default = singleton) para permitir chamar de dentro de
// uma transação — ver cardPurchases.service.js (lock antes de checar limite).
async function computeUsedLimit(cardId, client = prisma) {
  const result = await client.expense.aggregate({
    where: { type: 'card', deletedAt: null, status: { in: OPEN_EXPENSE_STATUSES }, cardInvoice: { cardId } },
    _sum: { value: true },
  });
  return Number(result._sum.value ?? 0);
}

/**
 * Versão em lote de computeUsedLimit: 1 query para N cartões (em vez de 1
 * por cartão). Usada por listCards e por qualquer outro módulo que precise
 * do usedLimit de vários cartões de uma vez (financialHealth, alerts —
 * ambos tinham o mesmo N+1 duplicado antes desta função existir).
 */
async function computeUsedLimitsByCard(cardIds, client = prisma) {
  if (cardIds.length === 0) return new Map();

  const openExpenses = await client.expense.findMany({
    where: { type: 'card', deletedAt: null, status: { in: OPEN_EXPENSE_STATUSES }, cardInvoice: { cardId: { in: cardIds } } },
    select: { value: true, cardInvoice: { select: { cardId: true } } },
  });

  const usedLimitByCard = new Map();
  for (const expense of openExpenses) {
    const key = String(expense.cardInvoice.cardId);
    usedLimitByCard.set(key, (usedLimitByCard.get(key) ?? 0) + Number(expense.value));
  }
  return usedLimitByCard;
}

/**
 * Quantas compras (parcelamentos) cada cartão já teve — usado só para a
 * listagem saber se o cartão tem histórico (e portanto se "excluir" precisa
 * apagar dados em cascata ou pode ser uma exclusão simples). Não filtra por
 * status como computeUsedLimitsByCard (qualquer compra já feita conta,
 * mesmo paga/quitada).
 */
async function computeHistoryCountsByCard(cardIds, client = prisma) {
  if (cardIds.length === 0) return new Map();

  const [purchases, invoices] = await Promise.all([
    client.cardPurchase.groupBy({
      by: ['cardId'],
      where: { cardId: { in: cardIds } },
      _count: { _all: true },
    }),
    client.cardInvoice.findMany({
      where: { cardId: { in: cardIds } },
      select: { cardId: true },
    }),
  ]);

  const map = new Map();
  for (const row of purchases) map.set(String(row.cardId), row._count._all);
  for (const invoice of invoices) {
    const key = String(invoice.cardId);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

/**
 * Antes: 1 query para listar os cartões + 1 query de agregação POR cartão
 * (N+1 clássico). Agora: sempre 2 queries no total, não importa quantos
 * cartões o usuário tenha — busca todas as parcelas em aberto de todos os
 * cartões de uma vez e soma por cartão em memória.
 */
async function listCards(userId) {
  const cards = await prisma.card.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
  if (cards.length === 0) return [];

  const [usedLimitByCard, historyCountByCard] = await Promise.all([
    computeUsedLimitsByCard(cards.map((c) => c.id)),
    computeHistoryCountsByCard(cards.map((c) => c.id)),
  ]);

  return cards.map((card) => {
    const usedLimit = usedLimitByCard.get(String(card.id)) ?? 0;
    return {
      ...card,
      usedLimit,
      availableLimit: Math.max(Number(card.limitValue) - usedLimit, 0),
      // Se nunca teve nenhuma compra, excluir é 100% seguro e imediato.
      // Se já teve, excluir precisa apagar em cascata (ou ser bloqueado
      // se tocar em mês encerrado) — ver deleteCard.
      hasHistory: (historyCountByCard.get(String(card.id)) ?? 0) > 0,
    };
  });
}

async function assertActiveCardSlot(userId, client) {
  const { entitlements } = await getUserPlan(userId, client);
  const activeLimit = entitlements.limits.activeCards;
  if (!Number.isFinite(activeLimit)) return;
  const activeCount = await client.card.count({ where: { userId, active: true } });
  if (activeCount >= activeLimit) {
    throw new AppError(
      `O Plano Básico permite até ${activeLimit} cartões ativos. Arquive um cartão ou faça upgrade para o Pro.`,
      403,
      'PLAN_LIMIT_REACHED',
      { resource: 'activeCards', limit: activeLimit, upgradePath: '/plan' }
    );
  }
}

async function createCard(userId, payload) {
  const card = await prisma.$transaction(async (tx) => {
    // Serializa criações e reativações simultâneas do mesmo usuário. Sem esse
    // lock, duas requisições poderiam enxergar 1 cartão ativo e ambas ocupar
    // a última vaga do Plano Básico.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${userId})`;
    await assertActiveCardSlot(userId, tx);
    return tx.card.create({ data: { userId, ...payload, active: true } });
  });
  await recordAuditLog(userId, 'card', card.id, 'create', { newValue: card });
  return card;
}

async function getOwnedCardOrThrow(userId, cardId, client = prisma) {
  const card = await client.card.findFirst({ where: { id: cardId, userId } });
  if (!card) {
    throw new AppError('Cartão não encontrado.', 404, 'CARD_NOT_FOUND');
  }
  return card;
}

async function updateCard(userId, cardId, payload) {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${cardId})`;
    const before = await getOwnedCardOrThrow(userId, cardId, tx);
    if (payload.limitValue !== undefined) {
      const usedLimit = await computeUsedLimit(cardId, tx);
      if (Number(payload.limitValue) + 0.009 < usedLimit) {
        throw new AppError(
          `O novo limite não pode ser menor que o valor já utilizado (R$ ${usedLimit.toFixed(2)}).`,
          422,
          'LIMIT_BELOW_USED'
        );
      }
    }
    const updated = await tx.card.update({ where: { id: cardId }, data: payload });
    return { before, updated };
  });
  await recordAuditLog(userId, 'card', cardId, 'update', { oldValue: result.before, newValue: result.updated });
  return result.updated;
}

async function deactivateCard(userId, cardId) {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${cardId})`;
    const before = await getOwnedCardOrThrow(userId, cardId, tx);
    // Cartão com parcelas futuras pendentes não pode simplesmente sumir do
    // sistema — apenas para de aceitar novas compras; faturas já geradas
    // continuam existindo e precisam ser pagas normalmente.
    const updated = await tx.card.update({ where: { id: cardId }, data: { active: false } });
    return { before, updated };
  });
  await recordAuditLog(userId, 'card', cardId, 'deactivate', { oldValue: result.before, newValue: result.updated });
  return result.updated;
}


async function activateCard(userId, cardId) {
  const result = await prisma.$transaction(async (tx) => {
    // Mantém a mesma serialização do createCard para que criar e reativar ao
    // mesmo tempo nunca ultrapasse o limite do plano. O lock do cartão evita
    // corrida com uma desativação/edição simultânea do mesmo registro.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${cardId})`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${userId})`;
    const before = await getOwnedCardOrThrow(userId, cardId, tx);
    if (before.active !== false) return { before, updated: before, changed: false };
    await assertActiveCardSlot(userId, tx);
    const updated = await tx.card.update({ where: { id: cardId }, data: { active: true } });
    return { before, updated, changed: true };
  });
  if (result.changed) {
    await recordAuditLog(userId, 'card', cardId, 'activate', { oldValue: result.before, newValue: result.updated });
  }
  return result.updated;
}

/**
 * Exclusão de verdade (não apenas desativar). Duas situações bem diferentes:
 *
 * 1. Cartão sem nenhuma compra/fatura: exclusão simples, sem risco nenhum.
 *
 * 2. Cartão com histórico: excluir de verdade significa apagar em cascata
 *    as despesas geradas por esse cartão (Expense.cardPurchaseId /
 *    cardInvoiceId), depois as compras e faturas, e só então o cartão —
 *    nessa ordem, por causa das foreign keys. Isso REESCREVE meses que já
 *    aconteceram (o total de gastos de um mês passado muda). Por isso, se
 *    qualquer uma dessas despesas pertence a um mês já encerrado (histórico
 *    imutável, mesma regra de months.service.assertMonthIsOpen), a exclusão
 *    é bloqueada — a única forma seria desativar o cartão em vez de excluir.
 *    Se todo o histórico está em meses ainda abertos, procede com o
 *    apagamento em cascata dentro de uma transação (tudo ou nada).
 */
async function deleteCard(userId, cardId) {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${cardId})`;
    const card = await getOwnedCardOrThrow(userId, cardId, tx);

    const linkedFixedTemplates = await tx.fixedExpenseTemplate.count({
      where: { userId, cardId, active: true },
    });
    if (linkedFixedTemplates > 0) {
      throw new AppError(
        `Este cartão está vinculado a ${linkedFixedTemplates} despesa(s) fixa(s) recorrente(s). Edite a forma de pagamento dessas despesas antes de excluir o cartão.`,
        409,
        'CARD_HAS_LINKED_FIXED_EXPENSES'
      );
    }

    const [purchases, invoices] = await Promise.all([
      tx.cardPurchase.findMany({ where: { cardId }, select: { id: true } }),
      tx.cardInvoice.findMany({ where: { cardId }, select: { id: true } }),
    ]);
    const purchaseIds = purchases.map((item) => item.id);
    const invoiceIds = invoices.map((item) => item.id);

    const linkedExpenses = await tx.expense.findMany({
      where: {
        OR: [
          ...(purchaseIds.length ? [{ cardPurchaseId: { in: purchaseIds } }] : []),
          ...(invoiceIds.length ? [{ cardInvoiceId: { in: invoiceIds } }] : []),
        ],
      },
      select: {
        id: true,
        paidAt: true,
        paidAmount: true,
        reversedAmount: true,
        month: { select: { status: true } },
      },
    });
    if (linkedExpenses.some((expense) => expense.month.status === 'closed')) {
      throw new AppError(
        'Este cartão tem despesas em meses já encerrados e não pode ser excluído. Use “Desativar” para preservar o histórico.',
        409,
        'CARD_HAS_CLOSED_HISTORY'
      );
    }
    const hasSettledCashFact = linkedExpenses.some((expense) =>
      expense.paidAt || Number(expense.paidAmount ?? 0) > 0.009 || Number(expense.reversedAmount ?? 0) > 0.009
    );
    if (getRequestWorkspaceType() !== 'simulation' && hasSettledCashFact) {
      throw new AppError(
        'Este cartão já possui pagamentos ou estornos registrados e não pode ser apagado do financeiro real. Use “Desativar” para preservar o caixa e a auditoria.',
        409,
        'CARD_HAS_SETTLED_HISTORY'
      );
    }

    // Só depois de TODAS as validações desvincula templates inativos. Se
    // qualquer etapa falhar, a transação desfaz inclusive essa mudança.
    await tx.fixedExpenseTemplate.updateMany({
      where: { userId, cardId, active: false },
      data: { cardId: null },
    });

    const expenseIds = linkedExpenses.map((expense) => expense.id);
    if (expenseIds.length) await tx.expense.deleteMany({ where: { id: { in: expenseIds } } });
    if (purchaseIds.length) await tx.cardPurchase.deleteMany({ where: { cardId } });
    if (invoiceIds.length) await tx.cardInvoice.deleteMany({ where: { cardId } });
    await tx.card.delete({ where: { id: cardId } });

    return {
      card,
      deletedCounts: {
        purchases: purchaseIds.length,
        invoices: invoiceIds.length,
        expenses: expenseIds.length,
      },
    };
  });

  await recordAuditLog(userId, 'card', cardId, 'delete', {
    oldValue: { ...result.card, ...result.deletedCounts },
  });
  return result;
}

module.exports = {
  listCards,
  createCard,
  getOwnedCardOrThrow,
  updateCard,
  deactivateCard,
  activateCard,
  deleteCard,
  computeUsedLimit,
  computeUsedLimitsByCard,
  computeHistoryCountsByCard,
};
