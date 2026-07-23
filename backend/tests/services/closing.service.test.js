jest.mock('../../src/config/prisma', () => require('../helpers/prismaMock').createPrismaMock());
jest.mock('../../src/modules/months/months.service');
jest.mock('../../src/modules/expenses/expenses.service');
jest.mock('../../src/modules/debts/debts.service');

const prismaMock = require('../../src/config/prisma');
const { installDefaults } = require('../helpers/prismaMock');
const monthsService = require('../../src/modules/months/months.service');
const { closeMonth } = require('../../src/modules/closing/closing.service');

beforeEach(() => {
  installDefaults(prismaMock);
  prismaMock.$queryRaw.mockResolvedValue([{ id: 3n, status: 'open', month: 6, year: 2026 }]);
  monthsService.getOrCreateMonth.mockResolvedValue({ id: 4n, month: 7, year: 2026 });
});

describe('closeMonth — AuditLog', () => {
  test('fechamento bem-sucedido grava audit log de close, depois do commit', async () => {
    const result = await closeMonth(10n, 3n);

    expect(result.closedMonth).toMatchObject({ id: 3n, month: 6, year: 2026 });
    expect(prismaMock.month.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 3n }, data: expect.objectContaining({ status: 'closed' }) })
    );
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 10n, entity: 'month', entityId: 3n, action: 'close' }) })
    );
  });

  test('mês já fechado entra em modo de reparo idempotente e não altera closedAt', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ id: 3n, status: 'closed', month: 6, year: 2026 }]);

    const result = await closeMonth(10n, 3n);

    expect(result.repaired).toBe(true);
    expect(prismaMock.month.update).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'repair_close' }) })
    );
  });

  test('mês inexistente/de outro usuário (lock não encontra linha) é rejeitado com 404', async () => {
    prismaMock.$queryRaw.mockResolvedValue([]);

    await expect(closeMonth(10n, 999n)).rejects.toMatchObject({ statusCode: 404, code: 'MONTH_NOT_FOUND' });
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });
});

describe('closeMonth — despesa fixa vinculada a cartão gera a próxima instância na fatura (REGRESSÃO)', () => {
  const expensesService = require('../../src/modules/expenses/expenses.service');

  beforeEach(() => {
    expensesService.dueDateFromDay.mockReturnValue(new Date('2026-07-10T00:00:00Z'));
  });

  test('template com paymentMethod=credit cria despesa tipo "card" presa à fatura, não uma "fixed" pendente comum', async () => {
    prismaMock.fixedExpenseTemplate.findMany.mockResolvedValue([
      { id: 9n, description: 'Plano de corte', categoryId: 2n, value: 50, dueDay: 10, paymentMethod: 'credit', cardId: 7n },
    ]);
    prismaMock.card.findMany.mockResolvedValue([{ id: 7n, userId: 10n, closingDay: 20, dueDay: 5, active: true, limitValue: 1000 }]);
    prismaMock.card.findFirst.mockResolvedValue({ id: 7n, userId: 10n, closingDay: 20, dueDay: 5, active: true, limitValue: 1000 });
    prismaMock.cardInvoice.findUnique.mockResolvedValue(null); // fatura ainda não existe, será criada

    await closeMonth(10n, 3n);

    const createCalls = prismaMock.expense.create.mock.calls.map((c) => c[0].data);
    const created = createCalls.find((d) => d.fixedTemplateId === 9n);

    expect(created).toMatchObject({ type: 'card', value: 50 });
    expect(created.cardInvoiceId).toBeDefined();
    expect(prismaMock.cardInvoice.update).toHaveBeenCalled(); // totalValue incrementado
  });

  test('template SEM cartão continua gerando despesa "fixed" comum, como antes', async () => {
    prismaMock.fixedExpenseTemplate.findMany.mockResolvedValue([
      { id: 10n, description: 'Aluguel', categoryId: 2n, value: 1200, dueDay: 5, paymentMethod: 'transfer', cardId: null },
    ]);

    await closeMonth(10n, 3n);

    const batch = prismaMock.expense.createMany.mock.calls[0][0].data;
    const created = batch.find((d) => d.fixedTemplateId === 10n);

    expect(created).toMatchObject({ type: 'fixed', value: 1200 });
    expect(created.cardInvoiceId).toBeUndefined();
  });
});

describe('closeMonth — data real da receita recorrente', () => {
  const expensesService = require('../../src/modules/expenses/expenses.service');

  test('preserva o dia configurado em vez de antecipar toda receita para o dia 1', async () => {
    const expectedDate = new Date('2026-07-15T00:00:00Z');
    expensesService.dueDateFromDay.mockReturnValue(expectedDate);
    prismaMock.incomeTemplate.findMany.mockResolvedValue([{
      id: 20n, userId: 10n, description: 'Salário', value: 3000, categoryId: 1n,
      paymentMethod: 'pix', incomeDay: 15, active: true,
    }]);
    prismaMock.income.findFirst.mockResolvedValue(null);

    await closeMonth(10n, 3n);

    expect(expensesService.dueDateFromDay).toHaveBeenCalledWith(
      expect.objectContaining({ id: 4n, month: 7, year: 2026 }),
      15
    );
    expect(prismaMock.income.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.arrayContaining([expect.objectContaining({ incomeDate: expectedDate })]) })
    );
  });
});
