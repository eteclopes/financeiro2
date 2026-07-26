jest.mock('../../src/config/prisma', () => require('../helpers/prismaMock').createPrismaMock());
// Mocka os serviços reutilizados para isolar a LÓGICA das automações.
jest.mock('../../src/modules/payments/payments.service');
jest.mock('../../src/modules/savings/savings.service');
jest.mock('../../src/modules/months/months.service');
jest.mock('../../src/modules/projections/projections.service');
jest.mock('../../src/modules/_shared/balance');

const prismaMock = require('../../src/config/prisma');
const { installDefaults } = require('../helpers/prismaMock');
const paymentsService = require('../../src/modules/payments/payments.service');
const savingsService = require('../../src/modules/savings/savings.service');
const monthsService = require('../../src/modules/months/months.service');
const projectionsService = require('../../src/modules/projections/projections.service');
const balance = require('../../src/modules/_shared/balance');
const automations = require('../../src/modules/automations/automations.service');

beforeEach(() => {
  installDefaults(prismaMock);
  monthsService.getMonthOrThrow.mockResolvedValue({ id: 60n, month: 10, year: 2026, status: 'open' });
  paymentsService.getPayableItems.mockResolvedValue({ bills: [], debts: [], invoices: [], totalSelectable: 0 });
  balance.getAvailableBalance.mockResolvedValue(0);
});

const CFG = { payDuesMethod: 'debit', payDebts: true, payBills: true, payInvoices: true, minimumBalance: 0 };

describe('runAutoPayments — paga por prioridade e nunca fica negativo', () => {
  test('paga dívidas, contas e faturas quando há saldo', async () => {
    balance.getAvailableBalance.mockResolvedValue(100000);
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

    const res = await automations.runAutoPayments(10n, 60n, CFG);
    expect(res.totalPaid).toBe(600);
    expect(res.paidDebts).toBe(1);
    expect(res.paidInvoices).toBe(1);
    expect(res.skipped).toEqual([]);
  });

  test('quando um grupo não cabe no saldo, ele é PULADO e os próximos seguem', async () => {
    balance.getAvailableBalance.mockResolvedValue(100);
    paymentsService.getPayableItems.mockResolvedValue({
      debts: [{ id: '1', amount: 5000 }],
      bills: [{ id: '2', amount: 50 }],
      invoices: [],
      totalSelectable: 5050,
    });
    // Dívidas são barradas na checagem de saldo, antes de tentar pagar.
    // Só as contas chegam a chamar o pagamento em lote.
    paymentsService.payBillsBatch.mockResolvedValue({ paidBillsCount: 1, total: 50 });

    const res = await automations.runAutoPayments(10n, 60n, CFG);
    // O grupo de dívidas (5000) não cabe nos 100 disponíveis: barrado antes
    // mesmo de tentar. As contas (50) seguem normalmente.
    expect(res.blockedByFloor.map((b) => b.group)).toContain('dívidas');
    expect(res.paidBills).toBe(1);
    expect(res.totalPaid).toBe(50);
  });

  test('respeita o PISO de saldo: não paga se deixar a conta abaixo do mínimo', async () => {
    balance.getAvailableBalance.mockResolvedValue(1000);
    paymentsService.getPayableItems.mockResolvedValue({
      debts: [], bills: [{ id: '2', amount: 800 }], invoices: [], totalSelectable: 800,
    });

    // Piso de 500: só há 500 de folga, e a conta custa 800.
    const res = await automations.runAutoPayments(10n, 60n, { ...CFG, minimumBalance: 500 });
    expect(res.totalPaid).toBe(0);
    expect(res.blockedByFloor[0]).toMatchObject({ group: 'contas', needed: 800 });
    expect(paymentsService.payBillsBatch).not.toHaveBeenCalled();
  });

  test('grupo DESLIGADO não é pago mesmo havendo saldo', async () => {
    balance.getAvailableBalance.mockResolvedValue(100000);
    paymentsService.getPayableItems.mockResolvedValue({
      debts: [{ id: '1', amount: 300 }], bills: [], invoices: [{ id: '9', amount: 200 }], totalSelectable: 500,
    });
    paymentsService.payBillsBatch.mockResolvedValue({ paidDebtsCount: 1, total: 300 });

    const res = await automations.runAutoPayments(10n, 60n, { ...CFG, payInvoices: false });
    expect(res.paidDebts).toBe(1);
    expect(res.paidInvoices).toBe(0);
    expect(paymentsService.payBillsBatch).toHaveBeenCalledTimes(1); // só dívidas
  });

  test('erro inesperado no pagamento propaga (não engole em silêncio)', async () => {
    paymentsService.getPayableItems.mockResolvedValue({ debts: [{ id: '1', amount: 10 }], bills: [], invoices: [], totalSelectable: 10 });
    balance.getAvailableBalance.mockResolvedValue(100000);
    paymentsService.payBillsBatch.mockRejectedValue(new Error('falha de banco'));
    await expect(automations.runAutoPayments(10n, 60n, CFG)).rejects.toThrow('falha de banco');
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


// ════════════════════════════════════════════════════════════════
// PRÉVIA: valida ANTES de mover dinheiro se a conta fecha.
// ════════════════════════════════════════════════════════════════
describe('previewAutomations — avisa quando o saldo não dá conta', () => {
  function cfg(extra = {}) {
    prismaMock.automationSetting.findUnique.mockResolvedValue({
      payDuesOnClose: true, payDuesMethod: 'debit',
      payDebts: true, payBills: true, payInvoices: true, minimumBalance: 0,
      saveLeftoverOnClose: false, saveLeftoverType: 'percent', saveLeftoverValue: 0,
      saveLeftoverBucketId: null, ...extra,
    });
  }

  test('mês atual: tudo cabe no saldo => ok, sem erros', async () => {
    cfg();
    balance.getAvailableBalance.mockResolvedValue(2000);
    paymentsService.getPayableItems.mockResolvedValue({
      debts: [{ id: '1', amount: 500 }], bills: [{ id: '2', amount: 300 }], invoices: [], totalSelectable: 800,
    });

    const p = await automations.previewAutomations(10n, 60n, 'current');
    expect(p.ok).toBe(true);
    expect(p.totalToPay).toBe(800);
    expect(p.balanceAfterPayments).toBe(1200);
    expect(p.groups.filter((g) => g.willPay)).toHaveLength(2);
  });

  test('saldo insuficiente => marca o grupo, informa o quanto falta e ok=false', async () => {
    cfg();
    balance.getAvailableBalance.mockResolvedValue(400);
    paymentsService.getPayableItems.mockResolvedValue({
      debts: [{ id: '1', amount: 1000 }], bills: [{ id: '2', amount: 100 }], invoices: [], totalSelectable: 1100,
    });

    const p = await automations.previewAutomations(10n, 60n, 'current');
    expect(p.ok).toBe(false);
    const dividas = p.groups.find((g) => g.key === 'debts');
    expect(dividas.willPay).toBe(false);
    expect(dividas.reason).toBe('sem_saldo');
    expect(dividas.missing).toBe(600); // 1000 - 400
    expect(p.warnings.some((w) => w.code === 'SALDO_INSUFICIENTE')).toBe(true);
    // As contas menores ainda cabem — a prévia não desiste de tudo.
    expect(p.groups.find((g) => g.key === 'bills').willPay).toBe(true);
  });

  test('PISO de saldo é respeitado na simulação', async () => {
    cfg({ minimumBalance: 500 });
    balance.getAvailableBalance.mockResolvedValue(1000);
    paymentsService.getPayableItems.mockResolvedValue({
      debts: [], bills: [{ id: '2', amount: 800 }], invoices: [], totalSelectable: 800,
    });

    const p = await automations.previewAutomations(10n, 60n, 'current');
    // Há 1000, mas só 500 de folga acima do piso: a conta de 800 não entra.
    expect(p.groups.find((g) => g.key === 'bills').willPay).toBe(false);
    expect(p.ok).toBe(false);
  });

  test('reserva é calculada sobre o que sobra ACIMA do piso', async () => {
    cfg({ minimumBalance: 200, saveLeftoverOnClose: true, saveLeftoverType: 'percent', saveLeftoverValue: 50 });
    balance.getAvailableBalance.mockResolvedValue(1200);
    paymentsService.getPayableItems.mockResolvedValue({
      debts: [], bills: [{ id: '2', amount: 200 }], invoices: [], totalSelectable: 200,
    });

    const p = await automations.previewAutomations(10n, 60n, 'current');
    // Sobra após pagar: 1000. Acima do piso (200) => 800. 50% = 400.
    expect(p.balanceAfterPayments).toBe(1000);
    expect(p.savings.amount).toBe(400);
    expect(p.balanceAfterSavings).toBe(600);
  });

  test('avisa quando não sobra nada para guardar', async () => {
    cfg({ saveLeftoverOnClose: true, saveLeftoverType: 'percent', saveLeftoverValue: 30 });
    balance.getAvailableBalance.mockResolvedValue(300);
    paymentsService.getPayableItems.mockResolvedValue({
      debts: [], bills: [{ id: '2', amount: 300 }], invoices: [], totalSelectable: 300,
    });

    const p = await automations.previewAutomations(10n, 60n, 'current');
    expect(p.savings.amount).toBe(0);
    expect(p.warnings.some((w) => w.code === 'SEM_SOBRA_PARA_RESERVA')).toBe(true);
  });

  test('próximo mês: usa a projeção e soma a receita recorrente esperada', async () => {
    cfg();
    balance.getAvailableBalance.mockResolvedValue(100);
    projectionsService.getProjectionComponents.mockResolvedValue({
      months: [{ month: 7, year: 2026 }, { month: 8, year: 2026 }],
      recurringIncome: 3000,
      fixedExpenses: 800,
      debtSchedule: [500, 500],
      cardSchedule: [0, 400],
    });

    const p = await automations.previewAutomations(10n, 60n, 'next');
    expect(p.month).toEqual({ month: 8, year: 2026 });
    expect(p.expectedIncome).toBe(3000);
    // 100 de saldo + 3000 de receita = 3100; paga 500 + 800 + 400 = 1700.
    expect(p.totalToPay).toBe(1700);
    expect(p.balanceAfterPayments).toBe(1400);
    expect(p.ok).toBe(true);
    // Deixa claro que são estimativas.
    expect(p.warnings.some((w) => w.code === 'ESTIMATIVA')).toBe(true);
  });

  test('a prévia NUNCA move dinheiro', async () => {
    cfg();
    balance.getAvailableBalance.mockResolvedValue(5000);
    paymentsService.getPayableItems.mockResolvedValue({
      debts: [{ id: '1', amount: 100 }], bills: [], invoices: [], totalSelectable: 100,
    });

    await automations.previewAutomations(10n, 60n, 'current');
    expect(paymentsService.payBillsBatch).not.toHaveBeenCalled();
    expect(savingsService.deposit).not.toHaveBeenCalled();
  });
});
