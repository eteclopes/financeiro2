jest.mock('../../src/config/prisma', () => require('../helpers/prismaMock').createPrismaMock());
jest.mock('../../src/modules/savings/savings.service');

const prismaMock = require('../../src/config/prisma');
const { installDefaults } = require('../helpers/prismaMock');
const savingsService = require('../../src/modules/savings/savings.service');
const { payInvoice } = require('../../src/modules/cards/cardInvoices.service');

// A fatura passou a ser travada com SELECT ... FOR UPDATE (duplo clique /
// duas abas). O mock precisa devolver a linha travada.
function lockInvoice(status = 'open') {
  prismaMock.$queryRaw.mockResolvedValue([{ id: 3n, status }]);
}

beforeEach(() => {
  installDefaults(prismaMock);
  savingsService.getBalanceBreakdown.mockResolvedValue({ totalReserved: 0, movedFromBalance: 0, externalReported: 0 });
  lockInvoice('open');
  prismaMock.expense.findMany.mockResolvedValue([
    { id: 21n, value: 700, paidAmount: 0 },
    { id: 22n, value: 500, paidAmount: 0 },
  ]);
});

describe('payInvoice — bloqueio de saldo (REGRESSÃO)', () => {
  test('bloqueia pagar a fatura se o saldo disponível não cobrir o total em aberto', async () => {
    prismaMock.income.aggregate.mockResolvedValue({ _sum: { value: 900 } });

    await expect(payInvoice(10n, 3n, 'debit')).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    expect(prismaMock.cardInvoice.update).not.toHaveBeenCalled();
  });

  test('paga normalmente quando o saldo cobre o total da fatura', async () => {
    prismaMock.income.aggregate.mockResolvedValue({ _sum: { value: 5000 } });

    await expect(payInvoice(10n, 3n, 'debit')).resolves.toBeDefined();
    expect(prismaMock.cardInvoice.update).toHaveBeenCalled();
  });

  test('fatura já paga é rejeitada antes de checar saldo', async () => {
    lockInvoice('paid');
    await expect(payInvoice(10n, 3n, 'debit')).rejects.toMatchObject({ code: 'INVOICE_ALREADY_PAID' });
  });

  test('fatura de outro usuário não é encontrada', async () => {
    prismaMock.$queryRaw.mockResolvedValue([]);
    await expect(payInvoice(10n, 3n, 'debit')).rejects.toMatchObject({ code: 'INVOICE_NOT_FOUND' });
  });

  test('pagar fatura com o próprio cartão de crédito é recusado', async () => {
    await expect(payInvoice(10n, 3n, 'credit')).rejects.toMatchObject({ code: 'INVALID_PAYMENT_METHOD' });
  });
});

describe('payInvoice — parcelas já pagas não são reescritas (F-03)', () => {
  test('somente as parcelas em aberto entram no UPDATE de pagamento', async () => {
    prismaMock.income.aggregate.mockResolvedValue({ _sum: { value: 5000 } });
    // A consulta já filtra status != 'paid'; o serviço nunca pode alcançar
    // outras linhas da fatura além dessas.
    prismaMock.expense.findMany.mockResolvedValue([{ id: 21n, value: 700, paidAmount: 0 }]);

    await payInvoice(10n, 3n, 'debit');

    const where = prismaMock.expense.findMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ not: 'paid' });
    expect(prismaMock.expense.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [21n] } } })
    );
  });

  test('fatura sem lançamentos pendentes não é paga', async () => {
    prismaMock.expense.findMany.mockResolvedValue([]);
    await expect(payInvoice(10n, 3n, 'debit')).rejects.toMatchObject({ code: 'EMPTY_INVOICE' });
  });
});
