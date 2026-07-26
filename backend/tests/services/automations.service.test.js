jest.mock('../../src/config/prisma', () => require('../helpers/prismaMock').createPrismaMock());
// Mocka os serviços reutilizados para isolar a LÓGICA das automações.
jest.mock('../../src/modules/payments/payments.service');
jest.mock('../../src/modules/savings/savings.service');
jest.mock('../../src/modules/months/months.service');
jest.mock('../../src/modules/_shared/balance');

const prismaMock = require('../../src/config/prisma');
const { installDefaults } = require('../helpers/prismaMock');
const paymentsService = require('../../src/modules/payments/payments.service');
const savingsService = require('../../src/modules/savings/savings.service');
const monthsService = require('../../src/modules/months/months.service');
const balance = require('../../src/modules/_shared/balance');
const automations = require('../../src/modules/automations/automations.service');

beforeEach(() => {
  installDefaults(prismaMock);
  monthsService.getMonthOrThrow.mockResolvedValue({ id: 60n, month: 10, year: 2026, status: 'open' });
  paymentsService.getPayableItems.mockResolvedValue({ bills: [], debts: [], invoices: [], totalSelectable: 0 });
  balance.getAvailableBalance.mockResolvedValue(0);
});

describe('runAutoPayments — paga por prioridade e nunca fica negativo', () => {
  test('paga dívidas, contas e faturas quando há saldo', async () => {
    paymentsService.getPayableItems.mockResolvedValue({
      debts: [{ id: '1', amount: 300 }],
      bills: [{ id: '2', amount: 100 }],
      invoices: [{ id: '9', amount: 200 }],
      totalSelectable: 600,
    });
    paymentsService.payBillsBatch
      .mockResolvedValueOnce({ paidDebtsCount: 1, total: 300 })
      .mockResolvedValueOnce({ paidBillsCount: 1, total: 100 })
      .mockResolvedValueOnce({ paidInvoicesCount: 1, total: 200 });

    const res = await automations.runAutoPayments(10n, 60n, 'debit');
    expect(res.totalPaid).toBe(600);
    expect(res.paidDebts).toBe(1);
    expect(res.paidInvoices).toBe(1);
    expect(res.skipped).toEqual([]);
  });

  test('quando um grupo não cabe no saldo, ele é PULADO e os próximos seguem', async () => {
    paymentsService.getPayableItems.mockResolvedValue({
      debts: [{ id: '1', amount: 5000 }],
      bills: [{ id: '2', amount: 50 }],
      invoices: [],
      totalSelectable: 5050,
    });
    const insufficient = Object.assign(new Error('sem saldo'), { code: 'INSUFFICIENT_BALANCE' });
    paymentsService.payBillsBatch
      .mockRejectedValueOnce(insufficient)            // dívidas: não cabe
      .mockResolvedValueOnce({ paidBillsCount: 1, total: 50 }); // contas: cabe

    const res = await automations.runAutoPayments(10n, 60n, 'debit');
    expect(res.skipped).toContain('dívidas');
    expect(res.paidBills).toBe(1);
    expect(res.totalPaid).toBe(50);
  });

  test('erro inesperado no pagamento propaga (não engole em silêncio)', async () => {
    paymentsService.getPayableItems.mockResolvedValue({ debts: [{ id: '1', amount: 10 }], bills: [], invoices: [], totalSelectable: 10 });
    paymentsService.payBillsBatch.mockRejectedValue(new Error('falha de banco'));
    await expect(automations.runAutoPayments(10n, 60n, 'debit')).rejects.toThrow('falha de banco');
  });
});

describe('runAutoSave — guarda sobra sem deixar negativo', () => {
  test('sem saldo disponível, não guarda nada', async () => {
    balance.getAvailableBalance.mockResolvedValue(0);
    const res = await automations.runAutoSave(10n, 60n, { type: 'percent', value: 30 });
    expect(res.saved).toBe(0);
    expect(savingsService.deposit).not.toHaveBeenCalled();
  });

  test('guarda a porcentagem da sobra', async () => {
    balance.getAvailableBalance.mockResolvedValue(1000);
    savingsService.deposit.mockResolvedValue({ bucket: { name: 'Emergência' } });
    const res = await automations.runAutoSave(10n, 60n, { type: 'percent', value: 30 });
    expect(res.saved).toBe(300);
    expect(savingsService.deposit).toHaveBeenCalledWith(10n, expect.objectContaining({ value: 300, origin: 'balance' }));
  });

  test('valor fixo é limitado ao que há de saldo', async () => {
    balance.getAvailableBalance.mockResolvedValue(120);
    savingsService.deposit.mockResolvedValue({ bucket: { name: 'Cofre' } });
    const res = await automations.runAutoSave(10n, 60n, { type: 'fixed', value: 500 });
    expect(res.saved).toBe(120); // nunca mais que o disponível
  });

  test('caixinha apagada no meio não derruba a automação', async () => {
    balance.getAvailableBalance.mockResolvedValue(500);
    savingsService.deposit.mockRejectedValue(Object.assign(new Error('x'), { code: 'INVALID_BUCKET' }));
    const res = await automations.runAutoSave(10n, 60n, { type: 'percent', value: 50 });
    expect(res.saved).toBe(0);
    expect(res.reason).toBe('falha_reserva');
  });
});

describe('runOnClose — nunca derruba o fechamento', () => {
  test('sem nenhuma automação ligada, não faz nada', async () => {
    prismaMock.automationSetting.findUnique.mockResolvedValue(null);
    const res = await automations.runOnClose(10n, 60n);
    expect(res).toBeNull();
  });

  test('roda só as automações ligadas', async () => {
    prismaMock.automationSetting.findUnique.mockResolvedValue({
      payDuesOnClose: true, payDuesMethod: 'debit',
      saveLeftoverOnClose: false, saveLeftoverType: 'percent', saveLeftoverValue: 0, saveLeftoverBucketId: null,
    });
    paymentsService.getPayableItems.mockResolvedValue({ debts: [], bills: [], invoices: [], totalSelectable: 0 });

    const res = await automations.runOnClose(10n, 60n);
    expect(res.payments).not.toBeNull();
    expect(res.savings).toBeNull();
  });

  test('erro numa automação vira aviso, não exceção (fechamento já ocorreu)', async () => {
    prismaMock.automationSetting.findUnique.mockResolvedValue({
      payDuesOnClose: true, payDuesMethod: 'debit',
      saveLeftoverOnClose: false, saveLeftoverType: 'percent', saveLeftoverValue: 0, saveLeftoverBucketId: null,
    });
    paymentsService.getPayableItems.mockRejectedValue(new Error('boom'));

    const res = await automations.runOnClose(10n, 60n);
    expect(res.error).toBe(true); // não lança
  });
});

describe('updateSettings — valida caixinha', () => {
  test('caixinha de outro usuário é rejeitada', async () => {
    prismaMock.savingsBucket.findFirst.mockResolvedValue(null);
    await expect(
      automations.updateSettings(10n, { saveLeftoverOnClose: true, saveLeftoverBucketId: '999' })
    ).rejects.toMatchObject({ code: 'INVALID_BUCKET' });
  });

  test('salva configuração válida', async () => {
    prismaMock.automationSetting.upsert.mockResolvedValue({
      payDuesOnClose: true, payDuesMethod: 'cash',
      saveLeftoverOnClose: true, saveLeftoverType: 'percent', saveLeftoverValue: 25, saveLeftoverBucketId: null,
    });
    const res = await automations.updateSettings(10n, { payDuesOnClose: true, payDuesMethod: 'cash', saveLeftoverOnClose: true, saveLeftoverValue: 25 });
    expect(res.payDuesMethod).toBe('cash');
    expect(res.saveLeftoverValue).toBe(25);
  });
});
