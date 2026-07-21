const prisma = require('../../config/prisma');
const AppError = require('../../utils/AppError');
const { assertSufficientBalance, lockUserBalance } = require('../_shared/balance');
const { todayUtcDate } = require('../../utils/dateTime');
const { round2 } = require('../../utils/math');

async function syncInvoiceStatuses(userId, cardId = null) {
  await prisma.cardInvoice.updateMany({
    where: {
      card: { userId, ...(cardId ? { id: cardId } : {}) },
      status: 'open',
      closingDate: { lt: todayUtcDate() },
    },
    data: { status: 'closed' },
  });
}

async function listInvoices(userId, cardId) {
  await syncInvoiceStatuses(userId, cardId);
  const invoices = await prisma.cardInvoice.findMany({
    where: { card: { id: cardId, userId } },
    include: {
      expenses: {
        where: { deletedAt: null },
        include: { category: true, fixedTemplate: true },
        orderBy: { dueDate: 'asc' },
      },
    },
    orderBy: [{ referenceYear: 'desc' }, { referenceMonth: 'desc' }],
  });

  return invoices.map((invoice) => ({
    ...invoice,
    totalValue: round2(invoice.expenses.reduce((sum, expense) => sum + Number(expense.value), 0)),
  }));
}

async function getOwnedInvoiceOrThrow(userId, invoiceId, client = prisma) {
  const invoice = await client.cardInvoice.findFirst({
    where: { id: invoiceId, card: { userId } },
    include: { card: true },
  });
  if (!invoice) throw new AppError('Fatura não encontrada.', 404, 'INVOICE_NOT_FOUND');
  return invoice;
}

async function payInvoice(userId, invoiceId, paymentMethod) {
  if (paymentMethod === 'credit') {
    throw new AppError('Não é possível pagar uma fatura com o próprio cartão de crédito.', 422, 'INVALID_PAYMENT_METHOD');
  }

  return prisma.$transaction(async (tx) => {
    await lockUserBalance(tx, userId);
    const invoice = await getOwnedInvoiceOrThrow(userId, invoiceId, tx);
    if (invoice.status === 'paid') {
      throw new AppError('Esta fatura já está paga.', 409, 'INVOICE_ALREADY_PAID');
    }

    const unpaidAgg = await tx.expense.aggregate({
      where: { cardInvoiceId: invoice.id, deletedAt: null, status: { not: 'paid' } },
      _sum: { value: true },
    });
    const amount = round2(Number(unpaidAgg._sum.value ?? 0));
    if (amount <= 0) {
      throw new AppError('Esta fatura não possui lançamentos pendentes.', 409, 'EMPTY_INVOICE');
    }
    await assertSufficientBalance(userId, amount, tx);

    const paidAt = todayUtcDate();
    await tx.expense.updateMany({
      where: { cardInvoiceId: invoice.id, deletedAt: null, status: { not: 'paid' } },
      data: { status: 'paid', paymentMethod, paidAt },
    });
    await tx.$executeRaw`
      UPDATE expenses
      SET paid_amount = value, paid_at = ${paidAt}
      WHERE card_invoice_id = ${invoice.id} AND deleted_at IS NULL
    `;

    return tx.cardInvoice.update({
      where: { id: invoice.id },
      data: { status: 'paid', paidAt },
    });
  });
}

module.exports = { listInvoices, getOwnedInvoiceOrThrow, payInvoice, syncInvoiceStatuses };
