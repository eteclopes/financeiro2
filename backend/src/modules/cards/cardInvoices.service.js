const prisma = require('../../config/prisma');
const AppError = require('../../utils/AppError');
const { assertSufficientBalance, lockUserBalance } = require('../_shared/balance');
const { todayUtcDate } = require('../../utils/dateTime');
const { round2 } = require('../../utils/math');

const MONEY_TOLERANCE = 0.009;

function isInvoiceCycleClosed(closingDate, today = todayUtcDate()) {
  return new Date(closingDate).getTime() < new Date(today).getTime();
}

function invoiceStatusAfterSettlement(closingDate, today = todayUtcDate()) {
  // Pagar antes do fechamento quita os lançamentos atuais, mas NÃO encerra o
  // ciclo. A fatura continua aberta e pode receber novas compras até o dia de
  // fechamento. Só uma fatura cujo ciclo já terminou pode ficar `paid`.
  return isInvoiceCycleClosed(closingDate, today) ? 'paid' : 'open';
}

function invoiceStatusWithOutstanding(closingDate, today = todayUtcDate()) {
  return isInvoiceCycleClosed(closingDate, today) ? 'closed' : 'open';
}

async function syncInvoiceStatuses(userId, cardId = null) {
  const scope = { card: { userId, ...(cardId ? { id: cardId } : {}) } };
  const today = todayUtcDate();
  const pendingExpense = { deletedAt: null, status: { not: 'paid' } };

  // 1) Ciclos que ainda não fecharam são SEMPRE abertos. Isto também repara
  // faturas futuras marcadas como `paid` pela versão antiga após antecipação.
  await prisma.cardInvoice.updateMany({
    where: {
      ...scope,
      closingDate: { gte: today },
      status: { not: 'open' },
    },
    data: { status: 'open' },
  });

  // 2) Depois do fechamento, saldo pendente significa fatura fechada.
  await prisma.cardInvoice.updateMany({
    where: {
      ...scope,
      closingDate: { lt: today },
      expenses: { some: pendingExpense },
      status: { not: 'closed' },
    },
    data: { status: 'closed', paidAt: null },
  });

  // 3) Depois do fechamento, sem nenhum lançamento pendente, a fatura está
  // efetivamente paga. `paidAt` das despesas continua sendo a fonte exata da
  // data de cada pagamento antecipado; não inventamos uma nova data aqui.
  await prisma.cardInvoice.updateMany({
    where: {
      ...scope,
      closingDate: { lt: today },
      expenses: { none: pendingExpense },
      status: { not: 'paid' },
    },
    data: { status: 'paid' },
  });
}

async function listInvoices(userId, cardId) {
  const { repairPendingFixedChargeAssignments } = require('./cardPurchases.service');
  await repairPendingFixedChargeAssignments(userId, cardId);
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

  return invoices
    // Fatura sem nenhum lançamento é apenas um artefato técnico.
    .filter((invoice) => invoice.expenses.length > 0)
    .map((invoice) => {
      const totalValue = round2(
        invoice.expenses.reduce((sum, expense) => sum + Number(expense.value), 0)
      );
      const outstandingValue = round2(invoice.expenses.reduce(
        (sum, expense) => sum + Math.max(Number(expense.value) - Number(expense.paidAmount ?? 0), 0),
        0
      ));
      return {
        ...invoice,
        totalValue,
        paidValue: round2(Math.max(totalValue - outstandingValue, 0)),
        outstandingValue,
        prepaid: invoice.status === 'open' && outstandingValue <= MONEY_TOLERANCE,
      };
    });
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
 * Quita todos os lançamentos atualmente pendentes da fatura.
 *
 * Se o ciclo ainda estiver aberto, isto é uma antecipação: os itens atuais
 * ficam pagos, o limite é liberado, mas a fatura permanece `open` e continua
 * aceitando cobranças até a data real de fechamento.
 */
async function payInvoice(userId, invoiceId, paymentMethod) {
  if (paymentMethod === 'credit') {
    throw new AppError('Não é possível pagar uma fatura com o próprio cartão de crédito.', 422, 'INVALID_PAYMENT_METHOD');
  }

  return prisma.$transaction(async (tx) => {
    await lockUserBalance(tx, userId);

    const lockedRows = await tx.$queryRaw`
      SELECT id, status, closing_date
      FROM card_invoices
      WHERE id = ${invoiceId}
        AND card_id IN (SELECT id FROM cards WHERE user_id = ${userId})
      FOR UPDATE
    `;
    if (lockedRows.length === 0) {
      throw new AppError('Fatura não encontrada.', 404, 'INVOICE_NOT_FOUND');
    }

    // O status isolado não decide se existe algo a pagar. Uma fatura antiga
    // pode ter sido marcada como `paid` cedo demais e depois recebido uma
    // cobrança; a fonte da verdade é o saldo dos lançamentos.
    const pending = await tx.expense.findMany({
      where: { cardInvoiceId: invoiceId, deletedAt: null, status: { not: 'paid' } },
      select: { id: true, value: true, paidAmount: true },
    });

    const amount = round2(
      pending.reduce((sum, item) => sum + (Number(item.value) - Number(item.paidAmount ?? 0)), 0)
    );
    if (pending.length === 0 || amount <= MONEY_TOLERANCE) {
      throw new AppError('Esta fatura não possui lançamentos pendentes.', 409, 'INVOICE_ALREADY_PAID');
    }
    await assertSufficientBalance(userId, amount, tx);

    const paidAt = todayUtcDate();
    const pendingIds = pending.map((item) => item.id);

    await tx.expense.updateMany({
      where: { id: { in: pendingIds } },
      data: { status: 'paid', paymentMethod, paidAt },
    });
    await tx.$executeRaw`
      UPDATE expenses SET paid_amount = value
      WHERE id = ANY(${pendingIds}::bigint[])
    `;

    const status = invoiceStatusAfterSettlement(lockedRows[0].closing_date, paidAt);
    return tx.cardInvoice.update({
      where: { id: invoiceId },
      data: { status, paidAt },
    });
  });
}

module.exports = {
  listInvoices,
  getOwnedInvoiceOrThrow,
  payInvoice,
  syncInvoiceStatuses,
  isInvoiceCycleClosed,
  invoiceStatusAfterSettlement,
  invoiceStatusWithOutstanding,
};
