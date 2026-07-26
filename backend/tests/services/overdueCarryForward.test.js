jest.mock('../../src/config/prisma', () => require('../helpers/prismaMock').createPrismaMock());
jest.mock('../../src/modules/months/months.service');

const prismaMock = require('../../src/config/prisma');
const { installDefaults } = require('../helpers/prismaMock');
const monthsService = require('../../src/modules/months/months.service');
const { listOverdueFromPreviousMonths } = require('../../src/modules/expenses/expenses.service');

beforeEach(() => {
  installDefaults(prismaMock);
  monthsService.getMonthOrThrow.mockResolvedValue({ id: 60n, month: 8, year: 2026, status: 'open' });
  prismaMock.expense.findMany.mockResolvedValue([]);
});

describe('Contas atrasadas de meses anteriores', () => {
  test('busca apenas meses cronologicamente ANTERIORES ao selecionado', async () => {
    await listOverdueFromPreviousMonths(10n, 60n);

    const where = prismaMock.expense.findMany.mock.calls[0][0].where;
    expect(where.month.OR).toEqual([
      { year: { lt: 2026 } },
      { year: 2026, month: { lt: 8 } },
    ]);
  });

  test('NÃO arrasta parcela de dívida (ela já rola sozinha na virada)', async () => {
    await listOverdueFromPreviousMonths(10n, 60n);
    const where = prismaMock.expense.findMany.mock.calls[0][0].where;
    // Só despesas comuns: incluir 'priority' contaria a mesma dívida 2x,
    // porque o não pago já é somado à parcela seguinte.
    expect(where.type).toEqual({ in: ['variable', 'fixed'] });
    expect(where.type.in).not.toContain('priority');
  });

  test('NÃO arrasta parcela de cartão (quitada pela fatura)', async () => {
    await listOverdueFromPreviousMonths(10n, 60n);
    const where = prismaMock.expense.findMany.mock.calls[0][0].where;
    expect(where.type.in).not.toContain('card');
  });

  test('traz pendentes, atrasadas e parcialmente pagas — nunca as já quitadas', async () => {
    await listOverdueFromPreviousMonths(10n, 60n);
    const where = prismaMock.expense.findMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ['pending', 'late', 'partial'] });
    expect(where.deletedAt).toBeNull();
  });

  test('devolve a conta com o mês de origem para a tela rotular "de 07/2026"', async () => {
    prismaMock.expense.findMany.mockResolvedValue([
      { id: 5n, description: 'Luz', value: 200, paidAmount: 0, status: 'late',
        month: { id: 59n, month: 7, year: 2026, status: 'closed' } },
    ]);
    const result = await listOverdueFromPreviousMonths(10n, 60n);
    expect(result[0].month).toMatchObject({ month: 7, year: 2026 });
  });
});
