jest.mock('../../src/config/prisma', () => require('../helpers/prismaMock').createPrismaMock());
jest.mock('../../src/modules/months/months.service');

const prismaMock = require('../../src/config/prisma');
const { installDefaults } = require('../helpers/prismaMock');
const monthsService = require('../../src/modules/months/months.service');
const { getMonthStatement } = require('../../src/modules/history/history.service');

beforeEach(() => {
  installDefaults(prismaMock);
  monthsService.getMonthOrThrow.mockResolvedValue({ id: 60n, month: 8, year: 2026, status: 'open' });
  prismaMock.expense.findMany.mockResolvedValue([]);
  prismaMock.income.findMany.mockResolvedValue([]);
  prismaMock.savingsTransaction.findMany.mockResolvedValue([]);
  prismaMock.goalContribution.findMany.mockResolvedValue([]);
});

describe('Extrato detalhado do mês', () => {
  test('parcela de dívida parcialmente paga mostra pago e o que faltou', async () => {
    prismaMock.expense.findMany.mockResolvedValue([{
      id: 5n, type: 'priority', description: 'TV (3/12)', value: 500, paidAmount: 200,
      status: 'partial', dueDate: new Date('2026-08-10'), paidAt: new Date('2026-08-09'),
      paymentMethod: 'debit', category: { name: 'Dívidas' },
      debt: { id: 1n, description: 'TV', installmentsCount: 12 }, cardInvoice: null,
    }]);

    const r = await getMonthStatement(10n, 60n);
    const e = r.entries[0];
    expect(e.installmentValue).toBe(500); // valor da parcela
    expect(e.paidAmount).toBe(200);       // quanto foi pago
    expect(e.remaining).toBe(300);        // quanto faltou (rola p/ a próxima)
    expect(e.isPartial).toBe(true);
    expect(e.debt.name).toBe('TV');
    expect(r.totals.paid).toBe(200);
    expect(r.totals.stillOwed).toBe(300);
    expect(r.totals.partialCount).toBe(1);
  });

  test('compra no cartão mostra o cartão e a fatura de destino', async () => {
    prismaMock.expense.findMany.mockResolvedValue([{
      id: 7n, type: 'card', description: 'Mercado', value: 150, paidAmount: 0,
      status: 'pending', dueDate: new Date('2026-08-05'), paidAt: null,
      paymentMethod: 'credit', category: null, debt: null,
      cardInvoice: { referenceMonth: 9, referenceYear: 2026, card: { name: 'Nubank' } },
    }]);

    const r = await getMonthStatement(10n, 60n);
    expect(r.entries[0].card).toBe('Nubank');
    expect(r.entries[0].invoiceRef).toEqual({ month: 9, year: 2026 });
  });

  test('junta receitas, reservas e metas num extrato ordenado por data', async () => {
    prismaMock.income.findMany.mockResolvedValue([
      { id: 1n, incomeDate: new Date('2026-08-01'), description: 'Salário', value: 3000, origin: 'digital', category: null },
    ]);
    prismaMock.savingsTransaction.findMany.mockResolvedValue([
      { id: 2n, type: 'deposit', transactionDate: new Date('2026-08-15'), value: 500, observation: null, origin: 'balance', bucket: { name: 'Emergência' } },
    ]);
    prismaMock.goalContribution.findMany.mockResolvedValue([
      { id: 3n, type: 'contribution', contributionDate: new Date('2026-08-20'), value: 200, goal: { name: 'Viagem' } },
    ]);

    const r = await getMonthStatement(10n, 60n);
    expect(r.entries.map((e) => e.kind)).toEqual(['income', 'savings_deposit', 'goal_contribution']);
    expect(r.totals.received).toBe(3000);
    expect(r.totals.savedToReserve).toBe(500);
    expect(r.totals.contributedToGoals).toBe(200);
  });

  test('reservas são recortadas por DATA (a tabela não guarda mês)', async () => {
    await getMonthStatement(10n, 60n);
    const where = prismaMock.savingsTransaction.findMany.mock.calls[0][0].where;
    expect(where.transactionDate.gte.toISOString().slice(0, 10)).toBe('2026-08-01');
    expect(where.transactionDate.lte.toISOString().slice(0, 10)).toBe('2026-08-31');
  });
});
