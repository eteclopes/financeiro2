jest.mock('../../src/config/prisma', () => require('../helpers/prismaMock').createPrismaMock());

const prismaMock = require('../../src/config/prisma');
const { installDefaults } = require('../helpers/prismaMock');
const { payBillsBatch } = require('../../src/modules/payments/payments.service');

beforeEach(() => {
  installDefaults(prismaMock);
  // Saldo alto por padrão; casos específicos reduzem.
  prismaMock.income.aggregate.mockResolvedValue({ _sum: { value: 100000 } });
  prismaMock.$queryRaw.mockResolvedValue([{ id: 900n, status: 'open' }]);
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
      expect.objectContaining({ data: expect.objectContaining({ status: 'paid' }) })
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

  test('recusa parcela de dívida no lote (pagamento flexível é individual)', async () => {
    prismaMock.expense.findMany.mockResolvedValueOnce([
      { id: 7n, userId: 10n, type: 'priority', status: 'pending', value: 300 },
    ]);
    await expect(
      payBillsBatch(10n, { expenseIds: ['7'], invoiceIds: [], paymentMethod: 'debit' })
    ).rejects.toMatchObject({ code: 'PAY_DEBT_INDIVIDUALLY' });
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
    prismaMock.$queryRaw.mockResolvedValue([{ id: 900n, status: 'paid' }]);
    await expect(
      payBillsBatch(10n, { expenseIds: [], invoiceIds: ['900'], paymentMethod: 'debit' })
    ).rejects.toMatchObject({ code: 'NOTHING_TO_PAY' });
  });
});
