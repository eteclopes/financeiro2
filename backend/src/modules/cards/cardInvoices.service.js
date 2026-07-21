const prisma = require('../../config/prisma');
const AppError = require('../../utils/AppError');
const { assertSufficientBalance } = require('../_shared/balance');

async function listInvoices(userId, cardId) {
  return prisma.cardInvoice.findMany({
    where: { card: { id: cardId, userId } },
    orderBy: [{ referenceYear: 'desc' }, { referenceMonth: 'desc' }],
  });
}

async function getOwnedInvoiceOrThrow(userId, invoiceId) {
  const invoice = await prisma.cardInvoice.findFirst({
    where: { id: invoiceId, card: { userId } },
    include: { card: true },
  });
  if (!invoice) {
    throw new AppError('Fatura não encontrada.', 404, 'INVOICE_NOT_FOUND');
  }
  return invoice;
}

/**
 * Pagar a fatura NÃO cria uma nova dívida — a dívida já nasceu na compra
 * (card_purchases/expenses tipo "card"). Aqui apenas quitamos, em bloco,
 * todas as parcelas que compõem esta fatura específica.
 */
async function payInvoice(userId, invoiceId, paymentMethod) {
  const invoice = await getOwnedInvoiceOrThrow(userId, invoiceId);

  if (invoice.status === 'paid') {
    throw new AppError('Esta fatura já está paga.', 409, 'INVOICE_ALREADY_PAID');
  }

  const unpaidAgg = await prisma.expense.aggregate({
    where: { cardInvoiceId: invoice.id, status: { not: 'paid' } },
    _sum: { value: true },
  });
  await assertSufficientBalance(userId, Number(unpaidAgg._sum.value ?? 0));

  return prisma.$transaction(async (tx) => {
    await tx.expense.updateMany({
      where: { cardInvoiceId: invoice.id, status: { not: 'paid' } },
      data: { status: 'paid', paymentMethod },
    });

    // paidAmount precisa ser igual ao value de cada parcela — updateMany não
    // permite "paidAmount = value" dinamicamente, então usamos SQL bruto
    // restrito a esta fatura (seguro: filtro idêntico ao updateMany acima).
    await tx.$executeRaw`UPDATE expenses SET paid_amount = value WHERE card_invoice_id = ${invoice.id}`;

    const updatedInvoice = await tx.cardInvoice.update({
      where: { id: invoice.id },
      data: { status: 'paid', paidAt: new Date() },
    });

    return updatedInvoice;
  });
}

module.exports = { listInvoices, getOwnedInvoiceOrThrow, payInvoice };
