const prisma = require('../../config/prisma');
const AppError = require('../../utils/AppError');
const { round2 } = require('../../utils/math');
const { todayUtcDate } = require('../../utils/dateTime');
const { assertSufficientBalance, lockUserBalance } = require('../_shared/balance');
const { normalizePaymentMethod } = require('../../utils/paymentMethods');

/**
 * Itens que podem ser pagos em lote pelo Dashboard.
 *
 * Inclui:
 *  - Contas comuns pendentes/atrasadas do mês (despesas variáveis e fixas).
 *  - Faturas de cartão em aberto (com saldo devedor > 0), de qualquer cartão
 *    do usuário, ordenadas por vencimento.
 *
 * NÃO inclui parcelas de dívida (type 'priority'): elas permitem pagamento
 * flexível (valor menor/maior, quitação antecipada) e continuam sendo pagas
 * individualmente. Também não inclui parcelas de cartão avulsas (type
 * 'card'): essas são quitadas pagando a fatura inteira.
 */
async function getPayableItems(userId, monthId) {
  const [bills, invoices] = await Promise.all([
    prisma.expense.findMany({
      where: {
        userId,
        monthId,
        deletedAt: null,
        status: { in: ['pending', 'late'] },
        type: { in: ['variable', 'fixed'] },
      },
      include: { category: true },
      orderBy: { dueDate: 'asc' },
    }),
    prisma.cardInvoice.findMany({
      where: { card: { userId }, status: { not: 'paid' } },
      include: { card: { select: { id: true, name: true } } },
      orderBy: { dueDate: 'asc' },
    }),
  ]);

  // Saldo em aberto de cada fatura em uma única consulta (evita N+1).
  const invoiceIds = invoices.map((invoice) => invoice.id);
  const pendingByInvoice = invoiceIds.length
    ? await prisma.expense.groupBy({
        by: ['cardInvoiceId'],
        where: { cardInvoiceId: { in: invoiceIds }, deletedAt: null, status: { not: 'paid' } },
        _sum: { value: true, paidAmount: true },
      })
    : [];
  const outstandingByInvoice = new Map(
    pendingByInvoice.map((row) => [
      String(row.cardInvoiceId),
      round2(Number(row._sum.value ?? 0) - Number(row._sum.paidAmount ?? 0)),
    ])
  );

  const payableBills = bills.map((bill) => ({
    id: String(bill.id),
    kind: 'expense',
    description: bill.description,
    category: bill.category ? { name: bill.category.name } : null,
    dueDate: bill.dueDate,
    amount: round2(Number(bill.value) - Number(bill.paidAmount ?? 0)),
    status: bill.status,
  }));

  const payableInvoices = invoices
    .map((invoice) => ({
      id: String(invoice.id),
      kind: 'invoice',
      description: `Fatura ${invoice.card?.name ?? 'cartão'}`,
      cardName: invoice.card?.name ?? null,
      referenceMonth: invoice.referenceMonth,
      referenceYear: invoice.referenceYear,
      dueDate: invoice.dueDate,
      amount: outstandingByInvoice.get(String(invoice.id)) ?? 0,
      status: invoice.status,
    }))
    // Uma fatura "aberta" sem lançamentos pendentes não deve aparecer.
    .filter((invoice) => invoice.amount > 0);

  const totalSelectable = round2(
    payableBills.reduce((sum, bill) => sum + bill.amount, 0)
      + payableInvoices.reduce((sum, invoice) => sum + invoice.amount, 0)
  );

  return { bills: payableBills, invoices: payableInvoices, totalSelectable };
}

/**
 * Paga VÁRIAS contas e/ou faturas de uma vez, numa única transação.
 *
 * Garantias:
 *  - Trava o saldo do usuário uma vez e confere o TOTAL de uma vez só. Não
 *    existe cenário de pagar metade e faltar dinheiro para a outra metade.
 *  - Idempotente: itens já pagos (por outra aba, duplo clique ou retry) são
 *    ignorados sem erro.
 *  - Faturas são travadas com FOR UPDATE, como no pagamento individual.
 *  - `paidAt` de parcelas já pagas de uma fatura nunca é reescrito.
 *  - Nunca deixa o saldo negativo: se o total exceder o disponível, nada é
 *    pago e o erro informa o total e o saldo.
 */
async function payBillsBatch(userId, { expenseIds = [], invoiceIds = [], paymentMethod }) {
  // Contas só podem ser pagas com saldo da conta ou dinheiro físico.
  const method = normalizePaymentMethod(paymentMethod, { allowCredit: false });

  const uniqueExpenseIds = [...new Set(expenseIds.map((id) => BigInt(id)))];
  const uniqueInvoiceIds = [...new Set(invoiceIds.map((id) => BigInt(id)))];

  if (uniqueExpenseIds.length === 0 && uniqueInvoiceIds.length === 0) {
    throw new AppError('Selecione ao menos uma conta ou fatura para pagar.', 422, 'NOTHING_SELECTED');
  }

  return prisma.$transaction(async (tx) => {
    await lockUserBalance(tx, userId);
    const paidAt = todayUtcDate();

    // ---------- Contas comuns ----------
    const expenses = uniqueExpenseIds.length
      ? await tx.expense.findMany({
          where: { id: { in: uniqueExpenseIds }, userId, deletedAt: null },
        })
      : [];

    if (expenses.length !== uniqueExpenseIds.length) {
      throw new AppError('Uma ou mais contas não foram encontradas.', 404, 'EXPENSE_NOT_FOUND');
    }

    const billsToPay = [];
    for (const expense of expenses) {
      if (['paid', 'settled'].includes(expense.status)) continue; // idempotente
      if (expense.type === 'card') {
        throw new AppError(
          'Parcelas de cartão são quitadas pagando a fatura inteira, não em lote de contas.',
          409, 'PAY_VIA_INVOICE', { expenseId: String(expense.id) }
        );
      }
      if (expense.type === 'priority') {
        throw new AppError(
          'Parcelas de dívida permitem pagamento flexível e devem ser pagas individualmente.',
          409, 'PAY_DEBT_INDIVIDUALLY', { expenseId: String(expense.id) }
        );
      }
      billsToPay.push(expense);
    }

    // ---------- Faturas ----------
    const invoicesToPay = [];
    for (const invoiceId of uniqueInvoiceIds) {
      const rows = await tx.$queryRaw`
        SELECT id, status FROM card_invoices
        WHERE id = ${invoiceId}
          AND card_id IN (SELECT id FROM cards WHERE user_id = ${userId})
        FOR UPDATE
      `;
      if (rows.length === 0) {
        throw new AppError('Uma ou mais faturas não foram encontradas.', 404, 'INVOICE_NOT_FOUND');
      }
      if (rows[0].status === 'paid') continue; // idempotente

      const pending = await tx.expense.findMany({
        where: { cardInvoiceId: invoiceId, deletedAt: null, status: { not: 'paid' } },
        select: { id: true, value: true, paidAmount: true },
      });
      const amount = round2(
        pending.reduce((sum, item) => sum + (Number(item.value) - Number(item.paidAmount ?? 0)), 0)
      );
      if (pending.length === 0 || amount <= 0) continue;

      invoicesToPay.push({ invoiceId, pendingIds: pending.map((item) => item.id), amount });
    }

    // ---------- Total e checagem única de saldo ----------
    const billsTotal = round2(billsToPay.reduce((sum, bill) => sum + Number(bill.value), 0));
    const invoicesTotal = round2(invoicesToPay.reduce((sum, invoice) => sum + invoice.amount, 0));
    const total = round2(billsTotal + invoicesTotal);

    if (total <= 0) {
      throw new AppError('Os itens selecionados já estão quitados.', 409, 'NOTHING_TO_PAY');
    }
    await assertSufficientBalance(userId, total, tx);

    // ---------- Aplica ----------
    for (const bill of billsToPay) {
      await tx.expense.update({
        where: { id: bill.id },
        data: { paidAmount: bill.value, paidAt, status: 'paid', paymentMethod: method },
      });
    }

    for (const invoice of invoicesToPay) {
      await tx.expense.updateMany({
        where: { id: { in: invoice.pendingIds } },
        data: { status: 'paid', paymentMethod: method, paidAt },
      });
      await tx.$executeRaw`
        UPDATE expenses SET paid_amount = value
        WHERE id = ANY(${invoice.pendingIds}::bigint[])
      `;
      await tx.cardInvoice.update({
        where: { id: invoice.invoiceId },
        data: { status: 'paid', paidAt },
      });
    }

    return {
      paidBillsCount: billsToPay.length,
      paidInvoicesCount: invoicesToPay.length,
      billsTotal,
      invoicesTotal,
      total,
      paymentMethod: method,
    };
  });
}

module.exports = { getPayableItems, payBillsBatch };
