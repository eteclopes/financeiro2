const prisma = require('../../config/prisma');
const AppError = require('../../utils/AppError');
const { round2 } = require('../../utils/math');
const { todayUtcDate } = require('../../utils/dateTime');
const { assertSufficientBalance, lockUserBalance } = require('../_shared/balance');
const { normalizePaymentMethod } = require('../../utils/paymentMethods');
const cardInvoicesService = require('../cards/cardInvoices.service');

const SETTLE_TOLERANCE = 0.009;

/**
 * Itens que podem ser pagos em lote pelo Dashboard: contas comuns pendentes,
 * parcelas de dívida (prioridade) e faturas de cartão em aberto.
 *
 * Parcelas avulsas de cartão (type 'card') NÃO entram: são quitadas pagando
 * a fatura inteira.
 */
async function getPayableItems(userId, monthId, { dueOnly = false } = {}) {
  const targetMonth = await prisma.month.findFirst({
    where: { id: monthId, userId },
    select: { month: true, year: true },
  });

  // Mantém os status em dia (fatura cujo fechamento já passou vira 'closed').
  await cardInvoicesService.syncInvoiceStatuses(userId);

  // QUAIS FATURAS ENTRAM NA LISTA
  //
  // Por padrão, TODAS as faturas com saldo em aberto. Uma compra feita em
  // julho depois do fechamento cai na fatura de agosto; escondê-la de quem
  // está em julho tirava do usuário a possibilidade de adiantar o pagamento.
  // Aqui a escolha é dele: ele vê a fatura, marca e paga.
  //
  // `dueOnly` existe para a AUTOMAÇÃO, que é outra história: lá o dinheiro
  // sai sozinho, sem ninguém conferindo na hora. Nesse caso só entram faturas
  // já fechadas (valor final) ou que vencem até o fim do mês — pagar
  // adiantado uma fatura ainda aberta cobraria uma conta que segue recebendo
  // lançamentos.
  let invoiceScope = {};
  if (dueOnly && targetMonth) {
    const endOfTargetMonth = new Date(Date.UTC(targetMonth.year, targetMonth.month, 0, 23, 59, 59, 999));
    invoiceScope = {
      OR: [
        { status: 'closed' },
        { dueDate: { lte: endOfTargetMonth } },
      ],
    };
  }

  const [bills, debtInstallments, invoices] = await Promise.all([
    // Contas do mês + contas em aberto que ficaram de meses anteriores, para
    // que uma conta atrasada possa ser quitada junto com as do mês corrente.
    prisma.expense.findMany({
      where: {
        userId,
        deletedAt: null,
        status: { in: ['pending', 'late', 'partial'] },
        type: { in: ['variable', 'fixed'] },
        OR: [
          { monthId },
          {
            month: {
              userId,
              OR: [
                { year: { lt: targetMonth?.year ?? 0 } },
                { year: targetMonth?.year ?? 0, month: { lt: targetMonth?.month ?? 0 } },
              ],
            },
          },
        ],
      },
      include: { category: true, month: { select: { month: true, year: true } } },
      orderBy: { dueDate: 'asc' },
    }),
    // Parcelas de dívida do mês + as que ficaram em aberto em meses
    // anteriores (plano esgotado, levadas adiante como atrasadas).
    prisma.expense.findMany({
      where: {
        userId,
        deletedAt: null,
        status: { in: ['pending', 'late', 'partial'] },
        type: 'priority',
        OR: [
          { monthId },
          {
            month: {
              userId,
              OR: [
                { year: { lt: targetMonth?.year ?? 0 } },
                { year: targetMonth?.year ?? 0, month: { lt: targetMonth?.month ?? 0 } },
              ],
            },
          },
        ],
      },
      include: { month: { select: { month: true, year: true } } },
      orderBy: { dueDate: 'asc' },
    }),
    prisma.cardInvoice.findMany({
      where: { card: { userId }, status: { not: 'paid' }, ...invoiceScope },
      include: { card: { select: { id: true, name: true } } },
      orderBy: { dueDate: 'asc' },
    }),
  ]);

  const invoiceIds = invoices.map((invoice) => invoice.id);
  const pendingByInvoice = invoiceIds.length
    ? await prisma.expense.groupBy({
        by: ['cardInvoiceId'],
        where: { cardInvoiceId: { in: invoiceIds }, deletedAt: null, status: { not: 'paid' } },
        _sum: { value: true, paidAmount: true },
      })
    : [];
  const outstandingByInvoice = new Map(
    pendingByInvoice.map((row) => [String(row.cardInvoiceId), round2(Number(row._sum.value ?? 0) - Number(row._sum.paidAmount ?? 0))])
  );

  const mapExpense = (e, kind) => {
    // Marca contas que vieram de um mês anterior, para a tela poder mostrar
    // "atrasada de 07/2026" em vez de parecer uma conta do mês corrente.
    const fromPrevious = Boolean(
      e.month && targetMonth
      && (e.month.year < targetMonth.year
        || (e.month.year === targetMonth.year && e.month.month < targetMonth.month))
    );
    return {
      id: String(e.id),
      kind,
      description: e.description,
      category: e.category ? { name: e.category.name } : null,
      dueDate: e.dueDate,
      amount: round2(Number(e.value) - Number(e.paidAmount ?? 0)),
      status: e.status,
      fromPreviousMonth: fromPrevious,
      originMonth: fromPrevious ? { month: e.month.month, year: e.month.year } : null,
    };
  };

  const payableBills = bills.map((e) => mapExpense(e, 'expense'));
  const payableDebts = debtInstallments.map((e) => mapExpense(e, 'debt'));

  const payableInvoices = invoices
    .map((invoice) => ({
      id: String(invoice.id),
      kind: 'invoice',
      description: `Fatura ${invoice.card?.name ?? 'cartão'}`,
      cardName: invoice.card?.name ?? null,
      referenceMonth: invoice.referenceMonth,
      referenceYear: invoice.referenceYear,
      dueDate: invoice.dueDate,
      closingDate: invoice.closingDate,
      amount: outstandingByInvoice.get(String(invoice.id)) ?? 0,
      status: invoice.status,
      // Fatura ainda aberta: pode receber novos lançamentos até fechar.
      // A tela avisa para o usuário saber que está adiantando.
      stillOpen: invoice.status === 'open',
    }))
    .filter((invoice) => invoice.amount > 0);

  const totalSelectable = round2(
    payableBills.reduce((s, i) => s + i.amount, 0)
      + payableDebts.reduce((s, i) => s + i.amount, 0)
      + payableInvoices.reduce((s, i) => s + i.amount, 0)
  );

  return { bills: payableBills, debts: payableDebts, invoices: payableInvoices, totalSelectable };
}

/**
 * Paga VÁRIAS contas, parcelas de dívida e/ou faturas de uma vez, numa única
 * transação.
 *
 * Garantias:
 *  - Trava o saldo e confere o TOTAL de uma vez. Nunca paga metade e falta
 *    dinheiro para o resto.
 *  - Idempotente: itens já pagos são ignorados sem erro; faturas travadas
 *    com FOR UPDATE.
 *  - `paidAt` de parcelas já pagas de uma fatura nunca é reescrito.
 *  - Parcela de dívida é paga pelo valor cheio da parcela e reduz o saldo
 *    devedor da dívida; várias parcelas da mesma dívida respeitam o saldo
 *    devedor (nunca abatem além do que se deve).
 */
async function payBillsBatch(userId, { expenseIds = [], invoiceIds = [], paymentMethod }) {
  const method = normalizePaymentMethod(paymentMethod, { allowCredit: false });

  const uniqueExpenseIds = [...new Set(expenseIds.map((id) => BigInt(id)))];
  const uniqueInvoiceIds = [...new Set(invoiceIds.map((id) => BigInt(id)))];

  if (uniqueExpenseIds.length === 0 && uniqueInvoiceIds.length === 0) {
    throw new AppError('Selecione ao menos uma conta ou fatura para pagar.', 422, 'NOTHING_SELECTED');
  }

  return prisma.$transaction(async (tx) => {
    await lockUserBalance(tx, userId);
    const paidAt = todayUtcDate();

    // ---------- Carrega despesas selecionadas ----------
    const expenses = uniqueExpenseIds.length
      ? await tx.expense.findMany({ where: { id: { in: uniqueExpenseIds }, userId, deletedAt: null } })
      : [];
    if (expenses.length !== uniqueExpenseIds.length) {
      throw new AppError('Uma ou mais contas não foram encontradas.', 404, 'EXPENSE_NOT_FOUND');
    }

    const billsToPay = [];         // variáveis/fixas (valor exato)
    const debtInstallments = [];   // parcelas de dívida (prioridade)
    for (const expense of expenses) {
      if (['paid', 'settled'].includes(expense.status)) continue; // idempotente
      if (expense.type === 'card') {
        throw new AppError('Parcelas de cartão são quitadas pagando a fatura.', 409, 'PAY_VIA_INVOICE', { expenseId: String(expense.id) });
      }
      if (expense.type === 'priority') debtInstallments.push(expense);
      else billsToPay.push(expense);
    }

    // ---------- Parcelas de dívida: agrupa por dívida e respeita o saldo devedor ----------
    const debtIds = [...new Set(debtInstallments.map((e) => e.debtId).filter(Boolean).map(String))];
    const debtsById = new Map();
    if (debtIds.length) {
      const rows = await tx.debt.findMany({
        where: { id: { in: debtInstallments.map((e) => e.debtId) }, userId },
      });
      for (const debt of rows) debtsById.set(String(debt.id), { ...debt, running: Number(debt.remainingBalance) });
    }

    const debtPayments = []; // { expenseId, amount, debtId }
    // Paga na ordem de vencimento para consumir o saldo devedor de forma previsível.
    const orderedDebtInstallments = [...debtInstallments].sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
    for (const inst of orderedDebtInstallments) {
      const debt = debtsById.get(String(inst.debtId));
      if (!debt) throw new AppError('Dívida da parcela não encontrada.', 404, 'DEBT_NOT_FOUND', { expenseId: String(inst.id) });
      const due = round2(Number(inst.value) - Number(inst.paidAmount ?? 0));
      const amount = round2(Math.min(due, debt.running));
      if (amount <= 0) continue;
      debt.running = round2(debt.running - amount);
      debtPayments.push({
        expenseId: inst.id,
        amount,
        fullValue: Number(inst.value),
        priorPaid: Number(inst.paidAmount ?? 0),
        debtId: inst.debtId,
      });
    }

    // ---------- Faturas ----------
    const invoicesToPay = [];
    for (const invoiceId of uniqueInvoiceIds) {
      const rows = await tx.$queryRaw`
        SELECT id, status FROM card_invoices
        WHERE id = ${invoiceId} AND card_id IN (SELECT id FROM cards WHERE user_id = ${userId})
        FOR UPDATE
      `;
      if (rows.length === 0) throw new AppError('Uma ou mais faturas não foram encontradas.', 404, 'INVOICE_NOT_FOUND');
      if (rows[0].status === 'paid') continue; // idempotente

      const pending = await tx.expense.findMany({
        where: { cardInvoiceId: invoiceId, deletedAt: null, status: { not: 'paid' } },
        select: { id: true, value: true, paidAmount: true },
      });
      const amount = round2(pending.reduce((sum, item) => sum + (Number(item.value) - Number(item.paidAmount ?? 0)), 0));
      if (pending.length === 0 || amount <= 0) continue;
      invoicesToPay.push({ invoiceId, pendingIds: pending.map((item) => item.id), amount });
    }

    // ---------- Total e checagem única de saldo ----------
    const billsTotal = round2(billsToPay.reduce((sum, bill) => sum + Number(bill.value), 0));
    const debtsTotal = round2(debtPayments.reduce((sum, dp) => sum + dp.amount, 0));
    const invoicesTotal = round2(invoicesToPay.reduce((sum, invoice) => sum + invoice.amount, 0));
    const total = round2(billsTotal + debtsTotal + invoicesTotal);

    if (total <= 0) throw new AppError('Os itens selecionados já estão quitados.', 409, 'NOTHING_TO_PAY');
    await assertSufficientBalance(userId, total, tx);

    // ---------- Aplica: contas comuns ----------
    for (const bill of billsToPay) {
      await tx.expense.update({
        where: { id: bill.id },
        data: { paidAmount: bill.value, paidAt, status: 'paid', paymentMethod: method },
      });
    }

    // ---------- Aplica: parcelas de dívida ----------
    for (const dp of debtPayments) {
      // ACUMULA sobre o que já havia sido pago na parcela — nunca sobrescreve
      // (senão um pagamento parcial anterior seria perdido).
      const newPaid = round2(dp.priorPaid + dp.amount);
      const isFull = newPaid >= dp.fullValue - SETTLE_TOLERANCE;
      await tx.expense.update({
        where: { id: dp.expenseId },
        data: { paidAmount: newPaid, paidAt, status: isFull ? 'paid' : 'partial', paymentMethod: method },
      });
    }
    // Atualiza o saldo devedor de cada dívida (uma vez por dívida).
    for (const [id, debt] of debtsById) {
      const paidForDebt = round2(debtPayments.filter((dp) => String(dp.debtId) === id).reduce((s, dp) => s + dp.amount, 0));
      if (paidForDebt <= 0) continue;
      const newRemaining = round2(Math.max(Number(debt.remainingBalance) - paidForDebt, 0));
      const settled = newRemaining <= SETTLE_TOLERANCE;
      await tx.debt.update({
        where: { id: debt.id },
        data: { remainingBalance: newRemaining, status: settled ? 'settled' : 'active', ...(settled ? { pendingCarryOver: 0 } : {}) },
      });
    }

    // ---------- Aplica: faturas ----------
    for (const invoice of invoicesToPay) {
      await tx.expense.updateMany({
        where: { id: { in: invoice.pendingIds } },
        data: { status: 'paid', paymentMethod: method, paidAt },
      });
      await tx.$executeRaw`UPDATE expenses SET paid_amount = value WHERE id = ANY(${invoice.pendingIds}::bigint[])`;
      await tx.cardInvoice.update({ where: { id: invoice.invoiceId }, data: { status: 'paid', paidAt } });
    }

    return {
      paidBillsCount: billsToPay.length,
      paidDebtsCount: debtPayments.length,
      paidInvoicesCount: invoicesToPay.length,
      billsTotal,
      debtsTotal,
      invoicesTotal,
      total,
      paymentMethod: method,
    };
  });
}

module.exports = { getPayableItems, payBillsBatch };
