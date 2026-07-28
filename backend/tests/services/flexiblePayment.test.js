jest.mock('../../src/config/prisma', () => require('../helpers/prismaMock').createPrismaMock());

const prismaMock = require('../../src/config/prisma');
const { installDefaults } = require('../helpers/prismaMock');
const { applyPaymentToInstallment } = require('../../src/modules/debts/debts.service');

const DEBT = { id: 1n, userId: 10n, remainingBalance: 1000, flexiblePayment: true, pendingCarryOver: 0 };
const parcela = (over = {}) => ({
  id: 7n, userId: 10n, debtId: 1n, value: 100, paidAmount: 0,
  status: 'pending', residualAmount: 0, carriedToExpenseId: null, deletedAt: null, ...over,
});

const lastExpenseUpdate = () => {
  const calls = prismaMock.expense.update.mock.calls;
  return calls[calls.length - 1][0];
};

beforeEach(() => {
  installDefaults(prismaMock);
  prismaMock.income.aggregate.mockResolvedValue({ _sum: { value: 100000 } });
  prismaMock.debt.findFirst.mockResolvedValue(DEBT);
});

// ═══════════════════════════════════════════════════════════════════
// Cenário do enunciado: parcela estimada 100, paga 50.
// ═══════════════════════════════════════════════════════════════════
describe('Pagamento flexível — a obrigação do mês é cumprida', () => {
  test('pagar 50 de uma parcela de 100 encerra o mês e deixa 50 de residual', async () => {
    prismaMock.expense.findFirst.mockResolvedValue(parcela());

    const r = await applyPaymentToInstallment(10n, parcela(), 50, 'debit');

    const data = lastExpenseUpdate().data;
    expect(data.status).toBe('flex_paid');   // sai das pendências do mês
    expect(data.paidAmount).toBe(50);
    expect(data.residualAmount).toBe(50);
    expect(r.flexible).toBe(true);
    // O saldo devedor cai só pelo que foi realmente pago.
    expect(prismaMock.debt.update.mock.calls[0][0].data.remainingBalance).toBe(950);
  });

  test('pagar o valor cheio marca como paga, sem residual', async () => {
    prismaMock.expense.findFirst.mockResolvedValue(parcela());

    await applyPaymentToInstallment(10n, parcela(), 100, 'debit');

    const data = lastExpenseUpdate().data;
    expect(data.status).toBe('paid');
    expect(data.residualAmount).toBe(0);
  });

  test('dívida SEM pagamento flexível continua exigindo o valor exato', async () => {
    prismaMock.debt.findFirst.mockResolvedValue({ ...DEBT, flexiblePayment: false });
    prismaMock.expense.findFirst.mockResolvedValue(parcela());

    await expect(applyPaymentToInstallment(10n, parcela(), 50, 'debit'))
      .rejects.toMatchObject({ code: 'EXACT_PAYMENT_REQUIRED' });
  });

  test('não aceita pagar acima do valor da parcela', async () => {
    prismaMock.expense.findFirst.mockResolvedValue(parcela());
    await expect(applyPaymentToInstallment(10n, parcela(), 250, 'debit'))
      .rejects.toMatchObject({ code: 'PAYMENT_ABOVE_INSTALLMENT' });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Item 4: pagar o residual depois, voluntariamente.
// ═══════════════════════════════════════════════════════════════════
describe('Saldo residual — pagamento posterior', () => {
  const encerrada = (over = {}) => parcela({
    status: 'flex_paid', paidAmount: 50, residualAmount: 50, ...over,
  });

  test('parcela encerrada com residual NÃO responde "já paga" — aceita pagamento', async () => {
    prismaMock.expense.findFirst.mockResolvedValue(encerrada());

    const r = await applyPaymentToInstallment(10n, encerrada(), 30, 'debit');
    expect(r.residualPayment).toBe(true);
  });

  test('pagar 30 dos 50 reduz o residual para 20 e NÃO reabre a parcela', async () => {
    prismaMock.expense.findFirst.mockResolvedValue(encerrada());

    await applyPaymentToInstallment(10n, encerrada(), 30, 'debit');

    const data = lastExpenseUpdate().data;
    expect(data.residualAmount).toBe(20);
    expect(data.paidAmount).toBe(80);          // 50 + 30
    expect(data.status).toBeUndefined();        // segue flex_paid: não reabre
    expect(data.residualSettledAt).toBeNull();
  });

  test('quitar os 50 zera o residual e registra a data da quitação', async () => {
    prismaMock.expense.findFirst.mockResolvedValue(encerrada());

    await applyPaymentToInstallment(10n, encerrada(), 50, 'debit');

    const data = lastExpenseUpdate().data;
    expect(data.residualAmount).toBe(0);
    expect(data.residualSettledAt).not.toBeNull();
  });

  test('pagar o residual REDUZ o acréscimo já lançado na próxima parcela', async () => {
    // O residual de 50 já tinha sido somado na parcela 8 (que virou 150).
    prismaMock.expense.findFirst
      .mockResolvedValueOnce(encerrada({ carriedToExpenseId: 8n }))   // a parcela sendo paga
      .mockResolvedValueOnce({ id: 8n, value: 150, status: 'pending', deletedAt: null }); // a próxima

    await applyPaymentToInstallment(10n, encerrada({ carriedToExpenseId: 8n }), 30, 'debit');

    // Sem isso, os mesmos 30 ficariam cobrados nos dois lugares.
    const nextUpdate = prismaMock.expense.update.mock.calls.find((c) => c[0].where.id === 8n);
    expect(nextUpdate[0].data.value).toBe(120); // 150 - 30
  });

  test('NUNCA aceita pagar acima do saldo residual', async () => {
    prismaMock.expense.findFirst.mockResolvedValue(encerrada());

    await expect(applyPaymentToInstallment(10n, encerrada(), 90, 'debit'))
      .rejects.toMatchObject({ code: 'PAYMENT_ABOVE_RESIDUAL' });
  });

  test('parcela paga integralmente e SEM residual recusa novo pagamento', async () => {
    prismaMock.expense.findFirst.mockResolvedValue(parcela({ status: 'paid', paidAmount: 100 }));

    await expect(applyPaymentToInstallment(10n, parcela({ status: 'paid' }), 10, 'debit'))
      .rejects.toMatchObject({ code: 'INSTALLMENT_ALREADY_PAID' });
  });

  test('quitar a parcela que RECEBEU resíduos zera os resíduos de origem', async () => {
    prismaMock.expense.findFirst.mockResolvedValue(parcela({ id: 8n, value: 150 }));

    await applyPaymentToInstallment(10n, parcela({ id: 8n, value: 150 }), 150, 'debit');

    // Os 50 vindos da parcela 7 foram pagos junto: não podem seguir cobráveis
    // nem ser somados de novo na próxima virada.
    expect(prismaMock.expense.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ carriedToExpenseId: 8n }),
        data: expect.objectContaining({ residualAmount: 0 }),
      })
    );
  });
});
