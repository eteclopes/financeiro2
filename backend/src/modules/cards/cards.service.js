const prisma = require('../../config/prisma');
const AppError = require('../../utils/AppError');
const { recordAuditLog } = require('../auditLog/auditLog.service');

// Status que ainda "consomem" limite — uma vez paga, a parcela libera limite,
// mesmo que o cartão físico real só libere no ciclo seguinte (simplificação
// deliberada documentada na auditoria final).
const OPEN_EXPENSE_STATUSES = ['pending', 'partial', 'late'];

// client opcional (default = singleton) para permitir chamar de dentro de
// uma transação — ver cardPurchases.service.js (lock antes de checar limite).
async function computeUsedLimit(cardId, client = prisma) {
  const result = await client.expense.aggregate({
    where: { type: 'card', status: { in: OPEN_EXPENSE_STATUSES }, cardInvoice: { cardId } },
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
    where: { type: 'card', status: { in: OPEN_EXPENSE_STATUSES }, cardInvoice: { cardId: { in: cardIds } } },
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

async function createCard(userId, payload) {
  const card = await prisma.card.create({ data: { userId, ...payload, active: true } });
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
  const card = await getOwnedCardOrThrow(userId, cardId);

  const linkedFixedTemplates = await prisma.fixedExpenseTemplate.count({
    where: { userId, cardId, active: true },
  });
  if (linkedFixedTemplates > 0) {
    throw new AppError(
      `Este cartão está vinculado a ${linkedFixedTemplates} despesa(s) fixa(s) recorrente(s). Edite a forma de pagamento dessas despesas antes de excluir o cartão.`,
      409,
      'CARD_HAS_LINKED_FIXED_EXPENSES'
    );
  }

  // Templates já desativados não devem manter uma FK invisível que impeça a exclusão.
  await prisma.fixedExpenseTemplate.updateMany({
    where: { userId, cardId, active: false },
    data: { cardId: null },
  });

  const [purchases, invoices] = await Promise.all([
    prisma.cardPurchase.findMany({ where: { cardId }, select: { id: true } }),
    prisma.cardInvoice.findMany({ where: { cardId }, select: { id: true } }),
  ]);
  const purchaseIds = purchases.map((p) => p.id);
  const invoiceIds = invoices.map((i) => i.id);

  if (purchaseIds.length === 0 && invoiceIds.length === 0) {
    await prisma.card.delete({ where: { id: cardId } });
    await recordAuditLog(userId, 'card', cardId, 'delete', { oldValue: card });
    return { card, deletedCounts: { purchases: 0, invoices: 0, expenses: 0 } };
  }

  const linkedExpenses = await prisma.expense.findMany({
    where: { OR: [{ cardPurchaseId: { in: purchaseIds } }, { cardInvoiceId: { in: invoiceIds } }] },
    select: { id: true, month: { select: { status: true } } },
  });

  const touchesClosedMonth = linkedExpenses.some((e) => e.month.status === 'closed');
  if (touchesClosedMonth) {
    throw new AppError(
      'Este cartão tem despesas em meses já encerrados (histórico imutável) e não pode ser excluído por completo. Use "Desativar" para parar de usá-lo sem apagar o histórico.',
      409,
      'CARD_HAS_CLOSED_HISTORY'
    );
  }

  const expenseIds = linkedExpenses.map((e) => e.id);

  await prisma.$transaction([
    prisma.expense.deleteMany({ where: { id: { in: expenseIds } } }),
    prisma.cardPurchase.deleteMany({ where: { cardId } }),
    prisma.cardInvoice.deleteMany({ where: { cardId } }),
    prisma.card.delete({ where: { id: cardId } }),
  ]);

  const deletedCounts = { purchases: purchaseIds.length, invoices: invoiceIds.length, expenses: expenseIds.length };
  await recordAuditLog(userId, 'card', cardId, 'delete', { oldValue: { ...card, ...deletedCounts } });
  return { card, deletedCounts };
}

module.exports = {
  listCards,
  createCard,
  getOwnedCardOrThrow,
  updateCard,
  deactivateCard,
  deleteCard,
  computeUsedLimit,
  computeUsedLimitsByCard,
  computeHistoryCountsByCard,
};
