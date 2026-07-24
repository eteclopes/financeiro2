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

/**
 * Pagamento INTEGRAL da fatura.
 *
 * Pagamento parcial NÃO está implementado de propósito — ver relatório:
 * exigiria decidir (regra de produto ainda não definida) como alocar um
 * valor parcial entre as parcelas da fatura e quanto de limite liberar.
 * Improvisar isso corromperia o limite do cartão. O caminho integral
 * permanece completo, transacional e idempotente.
 */
async function payInvoice(userId, invoiceId, paymentMethod) {
  if (paymentMethod === 'credit') {
    throw new AppError('Não é possível pagar uma fatura com o próprio cartão de crédito.', 422, 'INVALID_PAYMENT_METHOD');
  }

  return prisma.$transaction(async (tx) => {
    await lockUserBalance(tx, userId);

    // Trava a linha da fatura: duas requisições simultâneas (duplo clique ou
    // duas abas) são serializadas aqui, e a segunda encontra status='paid'.
    const lockedRows = await tx.$queryRaw`
      SELECT id, status FROM card_invoices
      WHERE id = ${invoiceId}
        AND card_id IN (SELECT id FROM cards WHERE user_id = ${userId})
      FOR UPDATE
    `;
    if (lockedRows.length === 0) {
      throw new AppError('Fatura não encontrada.', 404, 'INVOICE_NOT_FOUND');
    }
    if (lockedRows[0].status === 'paid') {
      throw new AppError('Esta fatura já está paga.', 409, 'INVOICE_ALREADY_PAID');
    }

    // Só as parcelas realmente em aberto entram no pagamento. Parcelas já
    // pagas antes NÃO são tocadas: reescrever `paidAt` delas mudaria a data
    // contábil de um pagamento que já aconteceu em outro mês.
    const pending = await tx.expense.findMany({
      where: { cardInvoiceId: invoiceId, deletedAt: null, status: { not: 'paid' } },
      select: { id: true, value: true, paidAmount: true },
    });

    const amount = round2(
      pending.reduce((sum, item) => sum + (Number(item.value) - Number(item.paidAmount ?? 0)), 0)
    );
    if (pending.length === 0 || amount <= 0) {
      throw new AppError('Esta fatura não possui lançamentos pendentes.', 409, 'EMPTY_INVOICE');
    }
    await assertSufficientBalance(userId, amount, tx);

    const paidAt = todayUtcDate();
    const pendingIds = pending.map((item) => item.id);

    await tx.expense.updateMany({
      where: { id: { in: pendingIds } },
      data: { status: 'paid', paymentMethod, paidAt },
    });
    // Prisma não expressa "coluna = coluna"; o SQL cru fica restrito aos ids
    // já selecionados acima, nunca à fatura inteira.
    await tx.$executeRaw`
      UPDATE expenses SET paid_amount = value
      WHERE id = ANY(${pendingIds}::bigint[])
    `;

    return tx.cardInvoice.update({
      where: { id: invoiceId },
      data: { status: 'paid', paidAt },
    });
  });
}

module.exports = { listInvoices, getOwnedInvoiceOrThrow, payInvoice, syncInvoiceStatuses };
