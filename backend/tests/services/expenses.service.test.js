jest.mock('../../src/config/prisma', () => require('../helpers/prismaMock').createPrismaMock());
jest.mock('../../src/modules/months/months.service');
jest.mock('../../src/modules/savings/savings.service');
jest.mock('../../src/modules/cards/cards.service');

const prismaMock = require('../../src/config/prisma');
const { installDefaults } = require('../helpers/prismaMock');
const monthsService = require('../../src/modules/months/months.service');
const savingsService = require('../../src/modules/savings/savings.service');
const cardsService = require('../../src/modules/cards/cards.service');
const { createVariableExpense, payExpense, createFixedExpense, updateFixedTemplate, deleteFixedTemplate } = require('../../src/modules/expenses/expenses.service');

const MONTH = { id: 1n, userId: 10n, status: 'open', month: 7, year: 2026 };

beforeEach(() => {
  installDefaults(prismaMock);
  monthsService.getMonthOrThrow.mockResolvedValue(MONTH);
  monthsService.assertMonthIsOpen.mockImplementation(() => {});
  savingsService.getBalanceBreakdown.mockResolvedValue({ totalReserved: 0, movedFromBalance: 0, externalReported: 0 });
  prismaMock.category.findFirst.mockResolvedValue({ id: 1n, userId: 10n });
});

describe('createVariableExpense — bloqueio de saldo ao criar já como paga (REGRESSÃO)', () => {
  test('bloqueia criar uma despesa já paga se não houver saldo suficiente', async () => {
    prismaMock.income.aggregate.mockResolvedValue({ _sum: { value: 400 } });
    prismaMock.expense.aggregate.mockResolvedValue({ _sum: { paidAmount: 0 } });

    const promise = createVariableExpense(10n, {
      monthId: 1n, description: 'Jantar', categoryId: 1n, date: new Date(),
      value: 500, paid: true, paymentMethod: 'pix',
    });

    await expect(promise).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    expect(prismaMock.expense.create).not.toHaveBeenCalled();
  });

  test('despesa criada como PENDENTE nunca é bloqueada por saldo (ainda não é um pagamento)', async () => {
    prismaMock.income.aggregate.mockResolvedValue({ _sum: { value: 0 } });
    prismaMock.expense.aggregate.mockResolvedValue({ _sum: { paidAmount: 0 } });

    await expect(createVariableExpense(10n, {
      monthId: 1n, description: 'Conta de luz', categoryId: 1n, date: new Date(),
      value: 500, paid: false,
    })).resolves.toBeDefined();
  });

  test('com saldo suficiente, cria normalmente', async () => {
    prismaMock.income.aggregate.mockResolvedValue({ _sum: { value: 1000 } });
    prismaMock.expense.aggregate.mockResolvedValue({ _sum: { paidAmount: 0 } });

    await expect(createVariableExpense(10n, {
      monthId: 1n, description: 'Mercado', categoryId: 1n, date: new Date(),
      value: 300, paid: true, paymentMethod: 'debit',
    })).resolves.toBeDefined();
  });
});

describe('createFixedExpense — vinculada a cartão de crédito (REGRESSÃO)', () => {
  beforeEach(() => {
    prismaMock.cardInvoice.findUnique.mockResolvedValue(null);
    prismaMock.card.findUnique.mockResolvedValue({ id: 7n, userId: 10n, closingDay: 20, dueDay: 5, active: true });
    monthsService.getOrCreateMonth.mockResolvedValue({ id: 2n, month: 8, year: 2026 });
  });

  test('paymentMethod=credit cria a instância como tipo "card", presa à fatura — nunca como "fixed" pendente comum', async () => {
    cardsService.getOwnedCardOrThrow.mockResolvedValue({ id: 7n, userId: 10n, closingDay: 20, dueDay: 5, active: true });

    const expense = await createFixedExpense(10n, {
      monthId: 1n, description: 'Plano de corte', categoryId: 1n, value: 50, dueDay: 10,
      paymentMethod: 'credit', cardId: 7n,
    });

    const createCall = prismaMock.expense.create.mock.calls[0][0];
    expect(createCall.data.type).toBe('card');
    expect(createCall.data.cardInvoiceId).toBeDefined();
    expect(prismaMock.cardInvoice.update).toHaveBeenCalled(); // totalValue da fatura foi incrementado
  });

  test('cartão desativado é rejeitado antes de criar qualquer coisa', async () => {
    cardsService.getOwnedCardOrThrow.mockResolvedValue({ id: 7n, userId: 10n, active: false });

    await expect(createFixedExpense(10n, {
      monthId: 1n, description: 'Netflix', categoryId: 1n, value: 40, dueDay: 10,
      paymentMethod: 'credit', cardId: 7n,
    })).rejects.toMatchObject({ code: 'CARD_INACTIVE' });
    expect(prismaMock.expense.create).not.toHaveBeenCalled();
  });

  test('paymentMethod diferente de credit continua gerando despesa "fixed" comum (comportamento inalterado)', async () => {
    const expense = await createFixedExpense(10n, {
      monthId: 1n, description: 'Aluguel', categoryId: 1n, value: 1200, dueDay: 5,
      paymentMethod: 'transfer',
    });

    const createCall = prismaMock.expense.create.mock.calls[0][0];
    expect(createCall.data.type).toBe('fixed');
    expect(createCall.data.cardInvoiceId).toBeUndefined();
  });
});

describe('payExpense — bloqueio de saldo ao pagar despesa fixa/variável pendente (REGRESSÃO)', () => {
  test('bloqueia pagar uma despesa pendente sem saldo suficiente, sem alterar nada', async () => {
    prismaMock.expense.findFirst.mockResolvedValue({
      id: 2n, userId: 10n, type: 'fixed', value: 500, status: 'pending', deletedAt: null,
    });
    prismaMock.income.aggregate.mockResolvedValue({ _sum: { value: 400 } });
    prismaMock.expense.aggregate.mockResolvedValue({ _sum: { paidAmount: 0 } });

    await expect(payExpense(10n, 2n, { amount: 500, paymentMethod: 'pix' }))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    expect(prismaMock.expense.update).not.toHaveBeenCalled();
  });

  test('paga normalmente quando há saldo suficiente', async () => {
    prismaMock.expense.findFirst.mockResolvedValue({
      id: 2n, userId: 10n, type: 'variable', value: 200, status: 'pending', deletedAt: null,
    });
    prismaMock.income.aggregate.mockResolvedValue({ _sum: { value: 1000 } });
    prismaMock.expense.aggregate.mockResolvedValue({ _sum: { paidAmount: 0 } });

    await expect(payExpense(10n, 2n, { amount: 200, paymentMethod: 'pix' })).resolves.toBeDefined();
    expect(prismaMock.expense.update).toHaveBeenCalled();
  });
});


describe('despesa fixa — edição e remoção preservam o histórico', () => {
  test('editar a recorrência recria o lançamento aberto com os novos dados', async () => {
    prismaMock.fixedExpenseTemplate.findFirst.mockResolvedValue({
      id: 9n, userId: 10n, description: 'Internet', value: 100, categoryId: 1n,
      dueDay: 10, paymentMethod: 'transfer', cardId: null,
    });
    prismaMock.expense.findMany.mockResolvedValue([{
      id: 30n, fixedTemplateId: 9n, status: 'pending', paidAmount: 0,
      competenceMonth: 7, competenceYear: 2026, observation: 'teste',
      cardInvoiceId: null, month: MONTH,
    }]);
    prismaMock.fixedExpenseTemplate.update.mockResolvedValue({
      id: 9n, description: 'Internet fibra', value: 120, categoryId: 1n,
      dueDay: 25, paymentMethod: 'transfer', cardId: null,
    });

    await updateFixedTemplate(10n, 9n, { description: 'Internet fibra', value: 120, dueDay: 25 });

    expect(prismaMock.expense.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [30n] } } });
    expect(prismaMock.expense.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({
        description: 'Internet fibra', value: 120, fixedTemplateId: 9n, type: 'fixed',
      }) })
    );
  });

  test('remover recorrência só apaga lançamentos sem nenhum pagamento', async () => {
    prismaMock.fixedExpenseTemplate.findFirst.mockResolvedValue({ id: 9n, userId: 10n });
    prismaMock.expense.findMany.mockResolvedValue([]);
    prismaMock.expense.count.mockResolvedValue(1);

    await deleteFixedTemplate(10n, 9n);

    expect(prismaMock.expense.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { in: ['pending', 'late'] },
        paidAmount: 0,
      }),
    }));
    expect(prismaMock.fixedExpenseTemplate.update).toHaveBeenCalledWith({
      where: { id: 9n }, data: { active: false },
    });
  });
});
