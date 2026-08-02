jest.mock('../../src/config/prisma', () => require('../helpers/prismaMock').createPrismaMock());

const prismaMock = require('../../src/config/prisma');
const { installDefaults } = require('../helpers/prismaMock');
const { payBillsBatch } = require('../../src/modules/payments/payments.service');

beforeEach(() => {
  installDefaults(prismaMock);
  // Saldo alto por padrão; casos específicos reduzem.
  prismaMock.income.aggregate.mockResolvedValue({ _sum: { value: 100000 } });
  prismaMock.$queryRaw.mockResolvedValue([{ id: 900n, status: 'open', closing_date: new Date('2099-12-10') }]);
});

describe('payBillsBatch — pagamento de várias contas + fatura', () => {
  test('paga contas comuns e uma fatura numa transação, somando o total', async () => {
    prismaMock.expense.findMany
      // 1ª chamada: carregar as despesas selecionadas
      .mockResolvedValueOnce([
        { id: 1n, userId: 10n, type: 'variable', status: 'pending', value: 200 },
        { id: 2n, userId: 10n, type: 'fixed', status: 'pending', value: 150 },
      ])
      // 2ª chamada: pendências da fatura 900
      .mockResolvedValueOnce([
        { id: 50n, value: 300, paidAmount: 0 },
        { id: 51n, value: 100, paidAmount: 0 },
      ]);

    const result = await payBillsBatch(10n, {
      expenseIds: ['1', '2'],
      invoiceIds: ['900'],
      paymentMethod: 'debit',
    });

    expect(result.paidBillsCount).toBe(2);
    expect(result.paidInvoicesCount).toBe(1);
    expect(result.billsTotal).toBe(350);
    expect(result.invoicesTotal).toBe(400);
    expect(result.total).toBe(750);
    // Duas contas atualizadas individualmente + as parcelas da fatura em bloco.
    expect(prismaMock.expense.update).toHaveBeenCalledTimes(2);
    expect(prismaMock.cardInvoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'open' }) })
    );
  });

  test('bloqueia tudo se o saldo não cobre o total (nada é pago)', async () => {
    prismaMock.income.aggregate.mockResolvedValue({ _sum: { value: 100 } });
    prismaMock.expense.findMany.mockResolvedValueOnce([
      { id: 1n, userId: 10n, type: 'variable', status: 'pending', value: 500 },
    ]);

    await expect(
      payBillsBatch(10n, { expenseIds: ['1'], invoiceIds: [], paymentMethod: 'debit' })
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    expect(prismaMock.expense.update).not.toHaveBeenCalled();
  });

  test('idempotente: item já pago é ignorado sem erro', async () => {
    prismaMock.expense.findMany.mockResolvedValueOnce([
      { id: 1n, userId: 10n, type: 'variable', status: 'paid', value: 200 },
      { id: 2n, userId: 10n, type: 'variable', status: 'pending', value: 150 },
    ]);

    const result = await payBillsBatch(10n, { expenseIds: ['1', '2'], invoiceIds: [], paymentMethod: 'debit' });
    expect(result.paidBillsCount).toBe(1);
    expect(result.total).toBe(150);
  });

  test('paga parcela de dívida no lote e reduz o saldo devedor', async () => {
    prismaMock.expense.findMany.mockResolvedValueOnce([
      { id: 7n, userId: 10n, type: 'priority', status: 'pending', value: 300, paidAmount: 0, debtId: 1n, dueDate: '2026-09-10' },
    ]);
    prismaMock.debt.findMany.mockResolvedValue([
      { id: 1n, userId: 10n, remainingBalance: 900, pendingCarryOver: 0 },
    ]);

    const result = await payBillsBatch(10n, { expenseIds: ['7'], invoiceIds: [], paymentMethod: 'debit' });
    expect(result.paidDebtsCount).toBe(1);
    expect(result.debtsTotal).toBe(300);
    expect(prismaMock.debt.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ remainingBalance: 600 }) })
    );
  });

  test('duas parcelas da mesma dívida não abatem além do saldo devedor', async () => {
    prismaMock.expense.findMany.mockResolvedValueOnce([
      { id: 7n, userId: 10n, type: 'priority', status: 'pending', value: 300, paidAmount: 0, debtId: 1n, dueDate: '2026-09-10' },
      { id: 8n, userId: 10n, type: 'priority', status: 'late', value: 300, paidAmount: 0, debtId: 1n, dueDate: '2026-08-10' },
    ]);
    // Dívida só deve R$ 400 no total, embora as 2 parcelas somem R$ 600.
    prismaMock.debt.findMany.mockResolvedValue([
      { id: 1n, userId: 10n, remainingBalance: 400, pendingCarryOver: 0 },
    ]);

    const result = await payBillsBatch(10n, { expenseIds: ['7', '8'], invoiceIds: [], paymentMethod: 'debit' });
    // Paga no máximo o saldo devedor: 400, não 600.
    expect(result.debtsTotal).toBe(400);
    expect(prismaMock.debt.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ remainingBalance: 0, status: 'settled' }) })
    );
  });

  test('recusa parcela de cartão avulsa no lote (paga pela fatura)', async () => {
    prismaMock.expense.findMany.mockResolvedValueOnce([
      { id: 8n, userId: 10n, type: 'card', status: 'pending', value: 90 },
    ]);
    await expect(
      payBillsBatch(10n, { expenseIds: ['8'], invoiceIds: [], paymentMethod: 'debit' })
    ).rejects.toMatchObject({ code: 'PAY_VIA_INVOICE' });
  });

  test('conta de outro usuário não é encontrada', async () => {
    prismaMock.expense.findMany.mockResolvedValueOnce([]); // nada retornado
    await expect(
      payBillsBatch(10n, { expenseIds: ['1'], invoiceIds: [], paymentMethod: 'debit' })
    ).rejects.toMatchObject({ code: 'EXPENSE_NOT_FOUND' });
  });

  test('nada selecionado é rejeitado', async () => {
    await expect(
      payBillsBatch(10n, { expenseIds: [], invoiceIds: [], paymentMethod: 'debit' })
    ).rejects.toMatchObject({ code: 'NOTHING_SELECTED' });
  });

  test('fatura já paga (nada mais a pagar) informa que já está quitada', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ id: 900n, status: 'paid', closing_date: new Date('2099-12-10') }]);
    await expect(
      payBillsBatch(10n, { expenseIds: [], invoiceIds: ['900'], paymentMethod: 'debit' })
    ).rejects.toMatchObject({ code: 'NOTHING_TO_PAY' });
  });
});

describe('payBillsBatch — parcela de dívida PARCIAL acumula (não sobrescreve)', () => {
  test('parcela com pagamento anterior é completada e marcada como paga', async () => {
    // Parcela value 500, já paga 100. Pagar no lote deve pagar os 400 que
    // faltam e marcar como PAGA (100 + 400 = 500), não como parcial.
    prismaMock.expense.findMany.mockResolvedValueOnce([
      { id: 9n, userId: 10n, type: 'priority', status: 'partial', value: 500, paidAmount: 100, debtId: 1n, dueDate: '2026-09-10' },
    ]);
    prismaMock.debt.findMany.mockResolvedValue([
      { id: 1n, userId: 10n, remainingBalance: 400, pendingCarryOver: 0 },
    ]);

    await payBillsBatch(10n, { expenseIds: ['9'], invoiceIds: [], paymentMethod: 'debit' });

    const upd = prismaMock.expense.update.mock.calls.find((c) => c[0].where.id === 9n)[0].data;
    expect(upd.paidAmount).toBe(500); // 100 anterior + 400 do lote
    expect(upd.status).toBe('paid');
  });
});

// ── Regressão: faturas de meses futuros não podem ser pagas em lote ──
describe('Escopo das faturas: lote manual x automação', () => {
  const { getPayableItems } = require('../../src/modules/payments/payments.service');

  beforeEach(() => {
    prismaMock.month.findFirst.mockResolvedValue({ month: 7, year: 2026 });
    prismaMock.expense.findMany.mockResolvedValue([]);
    prismaMock.cardInvoice.findMany.mockResolvedValue([]);
    prismaMock.expense.groupBy.mockResolvedValue([]);
  });

  test('lote MANUAL lista todas as faturas em aberto (usuário escolhe)', async () => {
    await getPayableItems(10n, 60n);
    const where = prismaMock.cardInvoice.findMany.mock.calls[0][0].where;
    // Sem recorte por vencimento: uma compra de julho cai na fatura de
    // agosto e precisa ficar visível para quem quer adiantar.
    expect(where.OR).toBeUndefined();
    expect(where.status).toEqual({ not: 'paid' });
  });

  test('AUTOMAÇÃO só enxerga o que já fechou ou vence no mês', async () => {
    await getPayableItems(10n, 60n, { dueOnly: true });
    const where = prismaMock.cardInvoice.findMany.mock.calls[0][0].where;
    expect(where.OR[0]).toEqual({ status: 'closed' });
    expect(where.OR[1].dueDate.lte instanceof Date).toBe(true);
  });

  test('fatura ainda aberta vem marcada para a tela avisar', async () => {
    prismaMock.cardInvoice.findMany.mockResolvedValue([
      { id: 900n, status: 'open', referenceMonth: 8, referenceYear: 2026, dueDate: new Date('2026-08-25'), closingDate: new Date('2026-08-18'), card: { id: 1n, name: 'Nubank' } },
    ]);
    prismaMock.expense.groupBy.mockResolvedValue([
      { cardInvoiceId: 900n, _sum: { value: 300, paidAmount: 0 } },
    ]);

    const items = await getPayableItems(10n, 60n);
    expect(items.invoices[0].stillOpen).toBe(true);
    expect(items.invoices[0].amount).toBe(300);
  });
});
