jest.mock('../../src/config/prisma', () => require('../helpers/prismaMock').createPrismaMock());
jest.mock('../../src/modules/savings/savings.service');

const prismaMock = require('../../src/config/prisma');
const { installDefaults } = require('../helpers/prismaMock');
const savingsService = require('../../src/modules/savings/savings.service');
const { payInvoice } = require('../../src/modules/cards/cardInvoices.service');

beforeEach(() => {
  installDefaults(prismaMock);
  savingsService.getBalanceBreakdown.mockResolvedValue({ totalReserved: 0, movedFromBalance: 0, externalReported: 0 });
  prismaMock.cardInvoice.findFirst.mockResolvedValue({
    id: 3n, status: 'open', card: { id: 7n, userId: 10n },
  });
});

describe('payInvoice — bloqueio de saldo ao pagar fatura (REGRESSÃO)', () => {
  test('bloqueia pagar a fatura se o saldo disponível não cobrir o total em aberto', async () => {
    prismaMock.expense.aggregate.mockResolvedValue({ _sum: { value: 1200 } }); // total em aberto da fatura
    prismaMock.income.aggregate.mockResolvedValue({ _sum: { value: 900 } });
    // paidAmount ainda não inclui esta fatura (é o que estamos prestes a pagar)

    await expect(payInvoice(10n, 3n, 'pix')).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    expect(prismaMock.cardInvoice.update).not.toHaveBeenCalled();
  });

  test('paga normalmente quando o saldo cobre o total da fatura', async () => {
    prismaMock.expense.aggregate.mockResolvedValue({ _sum: { value: 1200 } });
    prismaMock.income.aggregate.mockResolvedValue({ _sum: { value: 5000 } });

    await expect(payInvoice(10n, 3n, 'pix')).resolves.toBeDefined();
    expect(prismaMock.cardInvoice.update).toHaveBeenCalled();
  });

  test('fatura já paga é rejeitada antes mesmo de checar saldo', async () => {
    prismaMock.cardInvoice.findFirst.mockResolvedValue({ id: 3n, status: 'paid', card: { id: 7n, userId: 10n } });

    await expect(payInvoice(10n, 3n, 'pix')).rejects.toMatchObject({ code: 'INVOICE_ALREADY_PAID' });
  });
});
