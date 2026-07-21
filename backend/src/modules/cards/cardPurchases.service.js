const prisma = require('../../config/prisma');
const AppError = require('../../utils/AppError');
const monthsService = require('../months/months.service');
const expensesService = require('../expenses/expenses.service');
const cardsService = require('./cards.service');
const { addMonths } = require('../../utils/monthMath');
const { recordAuditLog } = require('../auditLog/auditLog.service');
const { round2 } = require('../../utils/math');

function clampDay(year, month, day) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 1, Math.min(day, lastDay)));
}

function firstInvoiceReference(purchaseDate, closingDay) {
  const day = purchaseDate.getUTCDate();
  const month = purchaseDate.getUTCMonth() + 1;
  const year = purchaseDate.getUTCFullYear();
  if (day <= closingDay) return { month, year };
  return addMonths(month, year, 1);
}

/**
 * O mês de referência identifica o ciclo que fecha naquele mês. Se o dia de
 * vencimento vem antes (ou no mesmo dia) do fechamento, o vencimento real é
 * no mês seguinte — comportamento usual dos cartões brasileiros.
 */
function invoiceDates(refMonth, refYear, closingDay, dueDay) {
  const closingDate = clampDay(refYear, refMonth, closingDay);
  const dueReference = dueDay <= closingDay
    ? addMonths(refMonth, refYear, 1)
    : { month: refMonth, year: refYear };
  const dueDate = clampDay(dueReference.year, dueReference.month, dueDay);
  return { closingDate, dueDate };
}

async function getOrCreateInvoice(card, refMonth, refYear, client = prisma) {
  const where = {
    cardId_referenceMonth_referenceYear: {
      cardId: card.id,
      referenceMonth: refMonth,
      referenceYear: refYear,
    },
  };
  const existing = await client.cardInvoice.findUnique({ where });
  if (existing) return existing;

  const month = await monthsService.getOrCreateMonth(card.userId, refMonth, refYear, client);
  const { closingDate, dueDate } = invoiceDates(
    refMonth,
    refYear,
    Number(card.closingDay),
    Number(card.dueDay)
  );

  try {
    return await client.cardInvoice.create({
      data: {
        cardId: card.id,
        monthId: month.id,
        referenceMonth: refMonth,
        referenceYear: refYear,
        closingDate,
        dueDate,
        totalValue: 0,
        status: 'open',
      },
    });
  } catch (error) {
    if (error?.code === 'P2002') {
      const concurrent = await client.cardInvoice.findUnique({ where });
      if (concurrent) return concurrent;
    }
    throw error;
  }
}

async function assertCardLimit(card, amount, client = prisma) {
  const usedLimit = await cardsService.computeUsedLimit(card.id, client);
  const availableLimit = round2(Number(card.limitValue) - usedLimit);
  if (round2(amount) > availableLimit + 0.009) {
    throw new AppError(
      `Limite insuficiente. Disponível: R$ ${Math.max(availableLimit, 0).toFixed(2)}.`,
      409,
      'INSUFFICIENT_LIMIT',
      { availableLimit: Math.max(availableLimit, 0), requestedAmount: round2(amount) }
    );
  }
  return availableLimit;
}

async function recalculateInvoiceTotal(invoiceId, client = prisma) {
  const aggregate = await client.expense.aggregate({
    where: { cardInvoiceId: invoiceId, deletedAt: null },
    _sum: { value: true },
  });
  const totalValue = round2(Number(aggregate._sum.value ?? 0));
  await client.cardInvoice.update({ where: { id: invoiceId }, data: { totalValue } });
  return totalValue;
}

/** Cria uma cobrança fixa real no cartão, preservando o mês de competência. */
async function createFixedCardCharge({ userId, card, template, month, dueDate, observation, client = prisma }) {
  await client.$executeRaw`SELECT pg_advisory_xact_lock(${card.id})`;
  // Releitura após o lock: impede que uma compra use limite/estado antigo
  // enquanto outra requisição reduz o limite ou desativa o cartão.
  const lockedCard = await cardsService.getOwnedCardOrThrow(userId, card.id, client);
  if (!lockedCard.active) {
    throw new AppError('Este cartão está desativado e não aceita novas despesas.', 409, 'CARD_INACTIVE');
  }
  await assertCardLimit(lockedCard, Number(template.value), client);

  const ref = firstInvoiceReference(dueDate, Number(lockedCard.closingDay));
  const invoice = await getOrCreateInvoice(lockedCard, ref.month, ref.year, client);

  const expense = await client.expense.create({
    data: {
      userId,
      monthId: month.id,
      type: 'card',
      description: template.description,
      categoryId: template.categoryId,
      dueDate,
      competenceMonth: month.month,
      competenceYear: month.year,
      value: template.value,
      status: 'pending',
      fixedTemplateId: template.id,
      cardInvoiceId: invoice.id,
      paymentMethod: 'credit',
      observation,
    },
    include: { category: true, fixedTemplate: true, cardInvoice: { include: { card: true } } },
  });

  await client.cardInvoice.update({
    where: { id: invoice.id },
    data: { totalValue: { increment: Number(template.value) } },
  });

  return { expense, invoice };
}

async function createCardPurchase(userId, payload) {
  const card = await cardsService.getOwnedCardOrThrow(userId, payload.cardId);
  if (!card.active) {
    throw new AppError('Este cartão está desativado e não aceita novas compras.', 409, 'CARD_INACTIVE');
  }
  await expensesService.assertCategoryIsValid(userId, payload.categoryId);

  const { installmentsCount, totalValue } = payload;
  const nominal = round2(totalValue / installmentsCount);
  const base = firstInvoiceReference(payload.purchaseDate, Number(card.closingDay));
  const startingInstallment = payload.startingInstallment ?? 1;
  const remainingTotalValue = round2(totalValue - nominal * (startingInstallment - 1));

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${card.id})`;
    const lockedCard = await cardsService.getOwnedCardOrThrow(userId, payload.cardId, tx);
    if (!lockedCard.active) {
      throw new AppError('Este cartão está desativado e não aceita novas compras.', 409, 'CARD_INACTIVE');
    }
    await assertCardLimit(lockedCard, remainingTotalValue, tx);

    const purchase = await tx.cardPurchase.create({
      data: {
        userId,
        cardId: card.id,
        description: payload.description,
        categoryId: payload.categoryId,
        totalValue: remainingTotalValue,
        installmentsCount: installmentsCount - startingInstallment + 1,
        installmentValue: nominal,
        purchaseDate: payload.purchaseDate,
      },
    });

    const expenses = [];
    let accumulated = 0;

    for (let i = startingInstallment; i <= installmentsCount; i += 1) {
      const ref = addMonths(base.month, base.year, i - 1);
      const invoice = await getOrCreateInvoice(lockedCard, ref.month, ref.year, tx);
      const value = i === installmentsCount ? round2(remainingTotalValue - accumulated) : nominal;
      accumulated = round2(accumulated + value);

      const expense = await tx.expense.create({
        data: {
          userId,
          monthId: invoice.monthId,
          type: 'card',
          description: installmentsCount > 1
            ? `${payload.description} (${i}/${installmentsCount})`
            : payload.description,
          categoryId: payload.categoryId,
          dueDate: invoice.dueDate,
          value,
          status: 'pending',
          paymentMethod: 'credit',
          cardInvoiceId: invoice.id,
          cardPurchaseId: purchase.id,
        },
      });

      await tx.cardInvoice.update({
        where: { id: invoice.id },
        data: { totalValue: { increment: value } },
      });
      expenses.push(expense);
    }

    return { purchase, expenses };
  }).then(async (result) => {
    await recordAuditLog(userId, 'cardPurchase', result.purchase.id, 'create', { newValue: result.purchase });
    return result;
  });
}

module.exports = {
  createCardPurchase,
  createFixedCardCharge,
  firstInvoiceReference,
  clampDay,
  invoiceDates,
  getOrCreateInvoice,
  assertCardLimit,
  recalculateInvoiceTotal,
};
