const prisma = require('../../config/prisma');
const AppError = require('../../utils/AppError');
const monthsService = require('../months/months.service');
const expensesService = require('../expenses/expenses.service');
const cardsService = require('./cards.service');
const { addMonths } = require('../../utils/monthMath');
const { recordAuditLog } = require('../auditLog/auditLog.service');
const { round2 } = require('../../utils/math');
const { todayUtcDate } = require('../../utils/dateTime');

const { clampDay, firstInvoiceReference, invoiceDates } = require('../../utils/cardCycle');

async function getOrCreateInvoice(card, refMonth, refYear, client = prisma) {
  const where = {
    cardId_referenceMonth_referenceYear: {
      cardId: card.id,
      referenceMonth: refMonth,
      referenceYear: refYear,
    },
  };
  const existing = await client.cardInvoice.findUnique({ where });
  if (existing) {
    // Pagamento antecipado não muda a referência do ciclo. A fatura pode
    // estar sem saldo no momento, mas continua sendo a dona das compras cuja
    // data pertence a este fechamento. Se uma nova cobrança entrar, ela será
    // reaberta abaixo sem saltar para o mês seguinte.
    return existing;
  }

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

function lifecycleStatusForNewCharge(invoice, card) {
  const closingDate = invoice.closingDate ?? invoiceDates(
    Number(invoice.referenceMonth),
    Number(invoice.referenceYear),
    Number(card.closingDay),
    Number(card.dueDay)
  ).closingDate;
  return new Date(closingDate).getTime() < todayUtcDate().getTime() ? 'closed' : 'open';
}

async function registerChargeOnInvoice(invoice, card, amount, client = prisma) {
  // Uma cobrança nova torna a fatura devedora novamente. Antes do fechamento
  // ela volta a `open`; depois do fechamento, a `closed`. Nunca é empurrada
  // para outro mês apenas porque houve um pagamento antecipado.
  return client.cardInvoice.update({
    where: { id: invoice.id },
    data: {
      totalValue: { increment: Number(amount) },
      status: lifecycleStatusForNewCharge(invoice, card),
      paidAt: null,
    },
  });
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

  await registerChargeOnInvoice(invoice, lockedCard, Number(template.value), client);

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
    let firstInvoice = null;

    for (let i = startingInstallment; i <= installmentsCount; i += 1) {
      const ref = addMonths(base.month, base.year, i - 1);
      const invoice = await getOrCreateInvoice(lockedCard, ref.month, ref.year, tx);
      if (!firstInvoice) firstInvoice = invoice;
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

      await registerChargeOnInvoice(invoice, lockedCard, value, tx);
      expenses.push(expense);
    }

    return {
      purchase,
      expenses,
      firstInvoice: firstInvoice && {
        id: String(firstInvoice.id),
        referenceMonth: firstInvoice.referenceMonth,
        referenceYear: firstInvoice.referenceYear,
        dueDate: firstInvoice.dueDate,
      },
    };
  }).then(async (result) => {
    await recordAuditLog(userId, 'cardPurchase', result.purchase.id, 'create', { newValue: result.purchase });
    return result;
  });
}

async function repairPendingFixedChargeAssignments(userId, cardId = null) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.expense.findMany({
      where: {
        userId,
        type: 'card',
        deletedAt: null,
        status: { not: 'paid' },
        fixedTemplateId: { not: null },
        cardInvoice: { card: { userId, ...(cardId ? { id: cardId } : {}) } },
      },
      include: {
        cardInvoice: { include: { card: true } },
      },
    });
    if (rows.length === 0) return { moved: 0 };

    const cardIds = [...new Set(rows.map((row) => String(row.cardInvoice.card.id)))].sort();
    for (const id of cardIds) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BigInt(id)})`;
    }

    const touchedInvoices = new Set();
    let moved = 0;
    for (const expense of rows) {
      const currentInvoice = expense.cardInvoice;
      const card = currentInvoice.card;
      const expected = firstInvoiceReference(expense.dueDate, Number(card.closingDay));
      if (
        Number(currentInvoice.referenceMonth) === Number(expected.month)
        && Number(currentInvoice.referenceYear) === Number(expected.year)
      ) {
        continue;
      }

      // O bug antigo sempre empurrava exatamente UM ciclo para frente porque
      // a fatura correta já estava paga antecipadamente. Para não reinterpretar
      // cobranças legítimas depois de uma edição do dia de fechamento, só
      // reparamos quando essas duas evidências existem.
      const next = addMonths(expected.month, expected.year, 1);
      const isExactlyOneCycleAhead =
        Number(currentInvoice.referenceMonth) === Number(next.month)
        && Number(currentInvoice.referenceYear) === Number(next.year);
      if (!isExactlyOneCycleAhead) continue;

      const targetInvoice = await tx.cardInvoice.findUnique({
        where: {
          cardId_referenceMonth_referenceYear: {
            cardId: card.id,
            referenceMonth: expected.month,
            referenceYear: expected.year,
          },
        },
      });
      const wasPrepaidBeforeCharge = targetInvoice?.paidAt
        && (!expense.createdAt || new Date(expense.createdAt).getTime() >= new Date(targetInvoice.paidAt).getTime());
      if (!targetInvoice || !wasPrepaidBeforeCharge) continue;

      await tx.expense.update({
        where: { id: expense.id },
        data: { cardInvoiceId: targetInvoice.id },
      });
      touchedInvoices.add(String(currentInvoice.id));
      touchedInvoices.add(String(targetInvoice.id));
      moved += 1;
    }

    for (const id of touchedInvoices) {
      await recalculateInvoiceTotal(BigInt(id), tx);
    }
    return { moved };
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
  lifecycleStatusForNewCharge,
  registerChargeOnInvoice,
  repairPendingFixedChargeAssignments,
};
