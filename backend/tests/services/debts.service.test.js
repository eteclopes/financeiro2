jest.mock('../../src/config/prisma', () => require('../helpers/prismaMock').createPrismaMock());
jest.mock('../../src/modules/months/months.service');
jest.mock('../../src/modules/expenses/expenses.service');
jest.mock('../../src/modules/savings/savings.service');

const prismaMock = require('../../src/config/prisma');
const { installDefaults } = require('../helpers/prismaMock');
const monthsService = require('../../src/modules/months/months.service');
const expensesService = require('../../src/modules/expenses/expenses.service');
const savingsService = require('../../src/modules/savings/savings.service');
const {
  createDebt, updateDebt, deleteDebt,
  applyPaymentToInstallment, generateNextInstallment,
} = require('../../src/modules/debts/debts.service');

beforeEach(() => {
  installDefaults(prismaMock);
  monthsService.getMonthOrThrow.mockResolvedValue({ id: 1n, userId: 10n, status: 'open' });
  monthsService.assertMonthIsOpen.mockImplementation(() => {});
  expensesService.assertCategoryIsValid.mockResolvedValue(undefined);
  expensesService.dueDateFromDay.mockReturnValue(new Date());
  savingsService.getBalanceBreakdown.mockResolvedValue({ totalReserved: 0, movedFromBalance: 0, externalReported: 0 });
  prismaMock.income.aggregate.mockResolvedValue({ _sum: { value: 100000 } }); // saldo folgado por padrão
  prismaMock.expense.findFirst.mockResolvedValue(makeExpense());
});

function makeDebt(overrides = {}) {
  return {
    id: 5n, userId: 10n, status: 'active', flexiblePayment: true,
    remainingBalance: 2000, installmentsCount: 12, installmentValue: 200, pendingCarryOver: 0,
    ...overrides,
  };
}

function makeExpense(overrides = {}) {
  return { id: 1n, userId: 10n, debtId: 5n, value: 200, status: 'pending', ...overrides };
}

describe('applyPaymentToInstallment — ajuste da PRÓXIMA parcela (REGRESSÃO)', () => {
  test('pagar a MAIS grava um carryOver negativo (crédito) na dívida', async () => {
    prismaMock.debt.findFirst.mockResolvedValue(makeDebt());

    await applyPaymentToInstallment(10n, makeExpense(), 260, 'pix');

    const [{ data }] = prismaMock.debt.update.mock.calls[0];
    expect(data.pendingCarryOver).toBe(-60);
    expect(data.remainingBalance).toBe(1740); // 2000 - 260, não 2000 - 200
  });

  test('pagar a MENOS (dívida flexível) grava um carryOver positivo', async () => {
    prismaMock.debt.findFirst.mockResolvedValue(makeDebt());

    await applyPaymentToInstallment(10n, makeExpense(), 150, 'pix');

    const [{ data }] = prismaMock.debt.update.mock.calls[0];
    expect(data.pendingCarryOver).toBe(50);
  });

  test('pagar o valor exato não altera o carryOver', async () => {
    prismaMock.debt.findFirst.mockResolvedValue(makeDebt({ pendingCarryOver: 0 }));

    await applyPaymentToInstallment(10n, makeExpense(), 200, 'pix');

    const [{ data }] = prismaMock.debt.update.mock.calls[0];
    expect(data.pendingCarryOver).toBe(0);
  });

  test('pagar a menos numa dívida SEM pagamento flexível é rejeitado (comportamento já existente, preservado)', async () => {
    prismaMock.debt.findFirst.mockResolvedValue(makeDebt({ flexiblePayment: false }));

    await expect(applyPaymentToInstallment(10n, makeExpense(), 150, 'pix'))
      .rejects.toMatchObject({ code: 'EXACT_PAYMENT_REQUIRED' });
  });

  test('pagamento que quita a dívida inteira zera o carryOver (não há próxima parcela para ajustar)', async () => {
    prismaMock.debt.findFirst.mockResolvedValue(makeDebt({ remainingBalance: 200, pendingCarryOver: 30 }));

    await applyPaymentToInstallment(10n, makeExpense(), 200, 'pix');

    const [{ data }] = prismaMock.debt.update.mock.calls[0];
    expect(data.pendingCarryOver).toBe(0);
    expect(data.status).toBe('settled');
  });

  test('parcela já parcialmente paga não aceita novo pagamento (o ajuste já foi propagado à próxima)', async () => {
    prismaMock.debt.findFirst.mockResolvedValue(makeDebt());
    prismaMock.expense.findFirst.mockResolvedValue(makeExpense({ status: 'partial' }));

    await expect(applyPaymentToInstallment(10n, makeExpense({ status: 'partial' }), 50, 'pix'))
      .rejects.toMatchObject({ code: 'INSTALLMENT_ALREADY_SETTLED' });
  });
});

describe('applyPaymentToInstallment — bloqueio de saldo insuficiente (REGRESSÃO)', () => {
  test('não permite pagar a parcela se não há saldo disponível suficiente', async () => {
    prismaMock.debt.findFirst.mockResolvedValue(makeDebt());
    prismaMock.income.aggregate.mockResolvedValue({ _sum: { value: 100 } }); // bem menos que a parcela

    await expect(applyPaymentToInstallment(10n, makeExpense(), 200, 'pix'))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    expect(prismaMock.debt.update).not.toHaveBeenCalled();
  });
});

describe('generateNextInstallment — aplica o carryOver pendente ao gerar a próxima parcela', () => {
  test('carryOver negativo (crédito de excedente) reduz a próxima parcela', async () => {
    const debt = makeDebt({ remainingBalance: 1740, pendingCarryOver: -60 });
    prismaMock.expense.count.mockResolvedValue(2); // 2 já geradas, 10 restantes

    const created = await generateNextInstallment(debt, { id: 2n });

    expect(created.value).toBe(140); // 200 - 60
  });

  test('carryOver positivo (falta de pagamento anterior) aumenta a próxima parcela', async () => {
    const debt = makeDebt({ remainingBalance: 1850, pendingCarryOver: 50 });
    prismaMock.expense.count.mockResolvedValue(2);

    const created = await generateNextInstallment(debt, { id: 2n });

    expect(created.value).toBe(250); // 200 + 50
  });

  test('depois de aplicado, o carryOver é zerado (não se repete nas parcelas seguintes)', async () => {
    const debt = makeDebt({ remainingBalance: 1740, pendingCarryOver: -60 });
    prismaMock.expense.count.mockResolvedValue(2);

    await generateNextInstallment(debt, { id: 2n });

    const [{ data }] = prismaMock.debt.update.mock.calls[0];
    expect(data.pendingCarryOver).toBe(0);
  });

  test('carryOver maior que o nominal é parcialmente aplicado, e a sobra persiste para a parcela seguinte', async () => {
    // excedente de 500 numa parcela nominal de 200: zera esta parcela e
    // ainda sobram 300 de crédito para a parcela DEPOIS desta.
    const debt = makeDebt({ remainingBalance: 5000, pendingCarryOver: -500 });
    prismaMock.expense.count.mockResolvedValue(2);

    const created = await generateNextInstallment(debt, { id: 2n });

    expect(created.value).toBe(0);
    const [{ data }] = prismaMock.debt.update.mock.calls[0];
    expect(data.pendingCarryOver).toBe(-300);
  });
});

describe('createDebt — startingInstallment (compra parcelada já em andamento) (REGRESSÃO)', () => {
  test('startingInstallment omitido (padrão 1) mantém o comportamento de sempre', async () => {
    await createDebt(10n, { monthId: 1n, categoryId: 1n, description: 'Financiamento', totalValue: 2400, installmentsCount: 12, flexiblePayment: false, dueDay: 10 });

    const debtData = prismaMock.debt.create.mock.calls[0][0].data;
    expect(debtData).toMatchObject({ totalValue: 2400, installmentsCount: 12, remainingBalance: 2400 });

    const expenseData = prismaMock.expense.create.mock.calls[0][0].data;
    expect(expenseData.description).toBe('Financiamento (1/12)');
    expect(expenseData.value).toBe(200);
  });

  test('startingInstallment=4 de 12: dívida nasce com só 9 parcelas restantes e o saldo já descontado das 3 anteriores', async () => {
    await createDebt(10n, {
      monthId: 1n, categoryId: 1n, description: 'Notebook', totalValue: 2400, installmentsCount: 12,
      flexiblePayment: false, dueDay: 10, startingInstallment: 4,
    });

    const debtData = prismaMock.debt.create.mock.calls[0][0].data;
    // 2400 - 3 parcelas de 200 já "elapsed" = 1800 restante, em 9 parcelas (4..12).
    expect(debtData).toMatchObject({ totalValue: 1800, installmentsCount: 9, remainingBalance: 1800 });

    const expenseData = prismaMock.expense.create.mock.calls[0][0].data;
    expect(expenseData.description).toBe('Notebook (4/12)'); // mantém a numeração original pro usuário reconhecer
    expect(expenseData.value).toBe(200); // ainda uma parcela nominal normal (não é a última)
  });

  test('startingInstallment = installmentsCount (última parcela): dívida nasce já quase quitada, só falta 1', async () => {
    await createDebt(10n, {
      monthId: 1n, categoryId: 1n, description: 'Sofá', totalValue: 1200, installmentsCount: 12,
      flexiblePayment: false, dueDay: 10, startingInstallment: 12,
    });

    const debtData = prismaMock.debt.create.mock.calls[0][0].data;
    expect(debtData.installmentsCount).toBe(1);
    expect(debtData.remainingBalance).toBe(100); // só a última parcela (nominal 100) resta
  });
});

describe('debts.service — AuditLog', () => {
  test('createDebt grava audit log de create depois do commit', async () => {
    prismaMock.debt.create.mockResolvedValue({ id: 5n, userId: 10n, totalValue: 300 });
    prismaMock.expense.create.mockResolvedValue({ id: 1n });

    await createDebt(10n, { monthId: 1n, categoryId: 1n, description: 'Financiamento', totalValue: 300, installmentsCount: 3, flexiblePayment: false, dueDay: 10 });

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 10n, entity: 'debt', entityId: 5n, action: 'create' }) })
    );
  });

  test('updateDebt grava audit log de update com valor antigo e novo', async () => {
    prismaMock.debt.findFirst.mockResolvedValue({ id: 5n, userId: 10n, description: 'Antiga' });
    prismaMock.debt.update.mockResolvedValue({ id: 5n, description: 'Nova' });
    prismaMock.expense.findMany.mockResolvedValue([]);

    await updateDebt(10n, 5n, { description: 'Nova' });

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entity: 'debt', entityId: 5n, action: 'update',
          oldValueJson: expect.objectContaining({ description: 'Antiga' }),
          newValueJson: expect.objectContaining({ description: 'Nova' }),
        }),
      })
    );
  });

  test('deleteDebt (soft delete) grava audit log de delete', async () => {
    prismaMock.debt.findFirst.mockResolvedValue({ id: 5n, userId: 10n, status: 'active' });
    prismaMock.debt.update.mockResolvedValue({ id: 5n, status: 'settled' });
    prismaMock.expense.deleteMany.mockResolvedValue({ count: 1 });

    await deleteDebt(10n, 5n);

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ entity: 'debt', entityId: 5n, action: 'delete' }) })
    );
  });

  test('deleteDebt não apaga parcela parcial ou já paga', async () => {
    prismaMock.debt.findFirst.mockResolvedValue({ id: 5n, userId: 10n, status: 'active' });
    prismaMock.debt.update.mockResolvedValue({ id: 5n, status: 'settled' });

    await deleteDebt(10n, 5n);

    expect(prismaMock.expense.deleteMany).toHaveBeenCalledWith({
      where: {
        debtId: 5n,
        status: { in: ['pending', 'late'] },
        paidAmount: 0,
        month: { status: 'open' },
      },
    });
  });

  test('dívida de outro usuário (404) não grava audit log nenhum', async () => {
    prismaMock.debt.findFirst.mockResolvedValue(null);

    await expect(updateDebt(10n, 999n, { description: 'x' })).rejects.toMatchObject({ statusCode: 404 });
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });
});
