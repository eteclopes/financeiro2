jest.mock('../../src/config/prisma', () => require('../helpers/prismaMock').createPrismaMock());
jest.mock('../../src/modules/_shared/balance');
jest.mock('../../src/modules/_shared/financialMetrics');
jest.mock('../../src/modules/months/months.service');
jest.mock('../../src/modules/payments/payments.service');
jest.mock('../../src/modules/savings/savings.service');

const prismaMock = require('../../src/config/prisma');
const { installDefaults } = require('../helpers/prismaMock');
const balance = require('../../src/modules/_shared/balance');
const metrics = require('../../src/modules/_shared/financialMetrics');
const monthsService = require('../../src/modules/months/months.service');
const paymentsService = require('../../src/modules/payments/payments.service');
const savingsService = require('../../src/modules/savings/savings.service');
const { getMonthlyPlan } = require('../../src/modules/planner/planner.service');

const pick = (plan, key) => plan.suggestions.find((s) => s.key === key);

beforeEach(() => {
  installDefaults(prismaMock);
  monthsService.getMonthOrThrow.mockResolvedValue({ id: 60n, month: 8, year: 2026, status: 'open' });
  paymentsService.getPayableItems.mockResolvedValue({ bills: [], debts: [], invoices: [] });
  savingsService.getCurrentBalance.mockResolvedValue(0);
  metrics.getAverageRecentExpense.mockResolvedValue(1000);
  balance.getAvailableBalance.mockResolvedValue(0);
  prismaMock.debt.findMany.mockResolvedValue([]);
  prismaMock.goal.findMany.mockResolvedValue([]);
});

describe('Plano do mês — sugestões em reais', () => {
  test('desconta os compromissos antes de sugerir (não sugere dinheiro com dono)', async () => {
    balance.getAvailableBalance.mockResolvedValue(3000);
    paymentsService.getPayableItems.mockResolvedValue({
      bills: [{ amount: 800 }], debts: [{ amount: 500 }], invoices: [{ amount: 700 }],
    });

    const plan = await getMonthlyPlan(10n, 60n);
    expect(plan.commitments.total).toBe(2000);
    // Livre de verdade = 3000 − 2000. Sugerir sobre os 3000 seria enganoso.
    expect(plan.reallyFree).toBe(1000);
  });

  test('reserva fraca: prioriza guardar, com valor em reais e o motivo', async () => {
    balance.getAvailableBalance.mockResolvedValue(2000);
    savingsService.getCurrentBalance.mockResolvedValue(500);   // cobre 0,5 mês
    metrics.getAverageRecentExpense.mockResolvedValue(1000);   // alvo = 3000

    const plan = await getMonthlyPlan(10n, 60n);
    const reserva = pick(plan, 'reserve');
    expect(reserva.priority).toBe('alta');
    // Teto de 50% da sobra: 2000 × 0,5 = 1000 (a lacuna é 2500, maior que isso).
    expect(reserva.amount).toBe(1000);
    expect(plan.reserve.gap).toBe(2500);
    expect(plan.reserve.coverageMonths).toBe(0.5);
  });

  test('reserva saudável: sugere pouco, só para manter o hábito', async () => {
    balance.getAvailableBalance.mockResolvedValue(1000);
    savingsService.getCurrentBalance.mockResolvedValue(5000); // já cobre 5 meses

    const plan = await getMonthlyPlan(10n, 60n);
    const reserva = pick(plan, 'reserve');
    expect(reserva.priority).toBe('baixa');
    expect(reserva.amount).toBe(100); // 10% da sobra
    expect(plan.reserve.gap).toBe(0);
  });

  test('as sugestões nunca somam mais do que está livre', async () => {
    balance.getAvailableBalance.mockResolvedValue(1200);
    savingsService.getCurrentBalance.mockResolvedValue(0);
    prismaMock.debt.findMany.mockResolvedValue([{ remainingBalance: 5000 }]);
    prismaMock.goal.findMany.mockResolvedValue([
      { name: 'Viagem', targetValue: 6000, targetDate: null, contributions: [] },
    ]);

    const plan = await getMonthlyPlan(10n, 60n);
    const total = plan.suggestions.reduce((acc, s) => acc + s.amount, 0);
    expect(total).toBeLessThanOrEqual(plan.reallyFree + 0.01);
    expect(pick(plan, 'free').amount).toBeGreaterThanOrEqual(0);
  });

  test('sem sobra: o valor livre é zero, nunca negativo', async () => {
    balance.getAvailableBalance.mockResolvedValue(500);
    paymentsService.getPayableItems.mockResolvedValue({
      bills: [{ amount: 900 }], debts: [], invoices: [],
    });

    const plan = await getMonthlyPlan(10n, 60n);
    expect(plan.reallyFree).toBe(0);
    expect(pick(plan, 'free').amount).toBe(0);
  });
});

describe('Avisos do plano', () => {
  test('avisa quando o saldo não cobre os compromissos, dizendo quanto falta', async () => {
    balance.getAvailableBalance.mockResolvedValue(500);
    paymentsService.getPayableItems.mockResolvedValue({
      bills: [{ amount: 900 }], debts: [], invoices: [],
    });

    const plan = await getMonthlyPlan(10n, 60n);
    const w = plan.warnings.find((x) => x.code === 'MES_NAO_FECHA');
    expect(w.level).toBe('error');
    expect(w.message).toContain('400.00'); // 900 − 500
  });

  test('avisa sobre contas atrasadas de meses anteriores', async () => {
    balance.getAvailableBalance.mockResolvedValue(5000);
    paymentsService.getPayableItems.mockResolvedValue({
      bills: [{ amount: 200, fromPreviousMonth: true }, { amount: 100 }], debts: [], invoices: [],
    });

    const plan = await getMonthlyPlan(10n, 60n);
    expect(plan.warnings.some((w) => w.code === 'ATRASADAS_ACUMULANDO')).toBe(true);
  });

  test('avisa quando a reserva cobre menos de um mês', async () => {
    balance.getAvailableBalance.mockResolvedValue(2000);
    savingsService.getCurrentBalance.mockResolvedValue(400); // 0,4 mês
    const plan = await getMonthlyPlan(10n, 60n);
    expect(plan.warnings.some((w) => w.code === 'RESERVA_MENOR_QUE_UM_MES')).toBe(true);
  });

  test('avisa quando a fatura sozinha já passa do saldo', async () => {
    balance.getAvailableBalance.mockResolvedValue(300);
    paymentsService.getPayableItems.mockResolvedValue({
      bills: [], debts: [], invoices: [{ amount: 900 }],
    });
    const plan = await getMonthlyPlan(10n, 60n);
    expect(plan.warnings.some((w) => w.code === 'FATURA_MAIOR_QUE_SALDO')).toBe(true);
  });
});
