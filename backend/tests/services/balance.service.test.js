jest.mock('../../src/config/prisma', () => require('../helpers/prismaMock').createPrismaMock());
jest.mock('../../src/modules/savings/savings.service');

const prismaMock = require('../../src/config/prisma');
const { installDefaults } = require('../helpers/prismaMock');
const savingsService = require('../../src/modules/savings/savings.service');
const { getAvailableBalance, assertSufficientBalance } = require('../../src/modules/_shared/balance');

function breakdown(overrides = {}) {
  return { totalReserved: 0, movedFromBalance: 0, externalReported: 0, ...overrides };
}

beforeEach(() => {
  installDefaults(prismaMock);
  savingsService.getBalanceBreakdown.mockResolvedValue(breakdown());
});

describe('getAvailableBalance', () => {
  test('renda total menos despesas já pagas (não pendentes)', async () => {
    prismaMock.income.aggregate.mockResolvedValue({ _sum: { value: 5000 } });
    prismaMock.expense.aggregate.mockResolvedValue({ _sum: { paidAmount: 3200 } });

    expect(await getAvailableBalance(10n)).toBe(1800);
  });

  test('dinheiro que SAIU do saldo para a reserva não conta como disponível', async () => {
    prismaMock.income.aggregate.mockResolvedValue({ _sum: { value: 5000 } });
    prismaMock.expense.aggregate.mockResolvedValue({ _sum: { paidAmount: 1000 } });
    savingsService.getBalanceBreakdown.mockResolvedValue(breakdown({ totalReserved: 1500, movedFromBalance: 1500 }));

    expect(await getAvailableBalance(10n)).toBe(2500); // 5000 - 1000 - 1500
  });

  test('REGRESSÃO (item 6): dinheiro já guardado fora do app (origin=external) NÃO reduz o saldo disponível', async () => {
    prismaMock.income.aggregate.mockResolvedValue({ _sum: { value: 5000 } });
    prismaMock.expense.aggregate.mockResolvedValue({ _sum: { paidAmount: 1000 } });
    // R$2000 reservados no total, mas só R$500 realmente saíram do saldo —
    // os outros R$1500 foram só "informados" (já estavam guardados fora do app).
    savingsService.getBalanceBreakdown.mockResolvedValue(
      breakdown({ totalReserved: 2000, movedFromBalance: 500, externalReported: 1500 })
    );

    // Antes desta correção, isto usava o total reservado (2000) inteiro,
    // devolvendo 2000 em vez de 3500 — penalizando o saldo disponível por
    // dinheiro que nunca saiu dele.
    expect(await getAvailableBalance(10n)).toBe(3500); // 5000 - 1000 - 500
  });

  test('sem nenhum lançamento ainda, saldo é zero (não undefined/NaN)', async () => {
    prismaMock.income.aggregate.mockResolvedValue({ _sum: { value: null } });
    prismaMock.expense.aggregate.mockResolvedValue({ _sum: { paidAmount: null } });

    expect(await getAvailableBalance(10n)).toBe(0);
  });
});

describe('assertSufficientBalance — bloqueio de pagamento sem saldo (REGRESSÃO)', () => {
  test('bloqueia quando o valor pedido é maior que o saldo disponível', async () => {
    prismaMock.income.aggregate.mockResolvedValue({ _sum: { value: 400 } });
    prismaMock.expense.aggregate.mockResolvedValue({ _sum: { paidAmount: 0 } });

    await expect(assertSufficientBalance(10n, 500)).rejects.toMatchObject({
      statusCode: 422,
      code: 'INSUFFICIENT_BALANCE',
    });
  });

  test('permite quando o valor pedido cabe no saldo disponível', async () => {
    prismaMock.income.aggregate.mockResolvedValue({ _sum: { value: 400 } });
    prismaMock.expense.aggregate.mockResolvedValue({ _sum: { paidAmount: 0 } });

    await expect(assertSufficientBalance(10n, 400)).resolves.toBe(400);
  });

  test('a mensagem de erro informa o saldo disponível de forma amigável', async () => {
    prismaMock.income.aggregate.mockResolvedValue({ _sum: { value: 400 } });
    prismaMock.expense.aggregate.mockResolvedValue({ _sum: { paidAmount: 0 } });

    await expect(assertSufficientBalance(10n, 500)).rejects.toMatchObject({
      details: { availableBalance: 400, requestedAmount: 500 },
    });
  });
});
