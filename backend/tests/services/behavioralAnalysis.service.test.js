jest.mock('../../src/config/prisma', () => require('../helpers/prismaMock').createPrismaMock());
jest.mock('../../src/modules/months/months.service');
jest.mock('../../src/modules/_shared/financialMetrics');

const prismaMock = require('../../src/config/prisma');
const { installDefaults } = require('../helpers/prismaMock');
const monthsService = require('../../src/modules/months/months.service');
const { getAllMonthsChronological } = require('../../src/modules/_shared/financialMetrics');
const { getBehavioralAnalysis } = require('../../src/modules/behavioralAnalysis/behavioralAnalysis.service');

const MONTHS = [
  { id: 1n, month: 4, year: 2026 },
  { id: 2n, month: 5, year: 2026 },
  { id: 3n, month: 6, year: 2026 },
];

beforeEach(() => {
  installDefaults(prismaMock);
  monthsService.getMonthOrThrow.mockResolvedValue(MONTHS[2]);
  getAllMonthsChronological.mockResolvedValue(MONTHS);
  prismaMock.category.findMany.mockResolvedValue([]);
});

describe('getBehavioralAnalysis — refactor de N+1 (por mês) para groupBy', () => {
  test('reconstrói income/expense por mês na ordem certa, com 0 para meses sem linha no groupBy', async () => {
    // Só o mês do meio (id=2) tem receita e despesa — os outros dois devem
    // virar 0 na série (não `undefined`), na ordem [mes1, mes2, mes3].
    prismaMock.income.groupBy.mockResolvedValue([{ monthId: 2n, _sum: { value: 500 } }]);
    // ordem real das chamadas a prisma.expense.groupBy no código-fonte:
    // 1) expenseRows  2) cardExpenseRows  3) debtExpenseRows  4) expensesByCategory
    prismaMock.expense.groupBy
      .mockResolvedValueOnce([{ monthId: 2n, _sum: { value: 300 } }]) // expenseRows
      .mockResolvedValueOnce([]) // cardExpenseRows
      .mockResolvedValueOnce([]) // debtExpenseRows
      .mockResolvedValueOnce([]); // expensesByCategory

    const result = await getBehavioralAnalysis(10n, 3n, 3);

    expect(result.income.series).toEqual([0, 500, 0]);
    expect(result.expenses.series).toEqual([0, 300, 0]);
  });

  test('cardDependency e debtInstallments usam o groupBy certo, na ordem certa', async () => {
    prismaMock.income.groupBy.mockResolvedValue([]);
    prismaMock.expense.groupBy
      .mockResolvedValueOnce([{ monthId: 1n, _sum: { value: 1000 } }, { monthId: 3n, _sum: { value: 500 } }]) // expenseRows
      .mockResolvedValueOnce([{ monthId: 1n, _sum: { value: 250 } }]) // cardExpenseRows
      .mockResolvedValueOnce([{ monthId: 1n, _sum: { value: 50 } }]) // debtExpenseRows
      .mockResolvedValueOnce([]); // expensesByCategory

    const result = await getBehavioralAnalysis(10n, 3n, 3);

    expect(result.expenses.series).toEqual([1000, 0, 500]);
    // mês 1: 250/1000 = 25%. mês 2: total 0 -> guard cai pra 0. mês 3: sem
    // despesa de cartão -> 0/500 = 0%.
    expect(result.cardDependency.series).toEqual([25, 0, 0]);
    expect(result.debtInstallments.series).toEqual([50, 0, 0]);
  });

  test('não quebra quando não há meses no período (usuário sem histórico)', async () => {
    getAllMonthsChronological.mockResolvedValue([]);
    monthsService.getMonthOrThrow.mockResolvedValue({ id: 999n, month: 1, year: 2026 });

    const result = await getBehavioralAnalysis(10n, 999n, 3);

    expect(result).toEqual({ periods: 0, analysis: null });
  });
});
