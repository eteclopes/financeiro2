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

describe('applyPaymentToInstallment — pagamento parcial coerente (top-up, sem carryOver)', () => {
  beforeEach(() => {
    // A função re-lê a parcela dentro da transação.
    prismaMock.expense.findFirst.mockResolvedValue(makeExpense());
  });

  test('pagamento flexível ENCERRA a parcela do mês e cria saldo residual', async () => {
    prismaMock.debt.findFirst.mockResolvedValue(makeDebt());
    prismaMock.expense.findFirst.mockResolvedValue(makeExpense({ paidAmount: 0 }));

    await applyPaymentToInstallment(10n, makeExpense(), 150, 'pix');

    const expenseUpdate = prismaMock.expense.update.mock.calls[0][0].data;
    expect(expenseUpdate.paidAmount).toBe(150);
    // O valor era ESTIMADO, não mínimo: a obrigação do mês foi cumprida.
    expect(expenseUpdate.status).toBe('flex_paid');
    expect(expenseUpdate.residualAmount).toBe(50); // 200 estimado - 150 pago
    const debtUpdate = prismaMock.debt.update.mock.calls[0][0].data;
    expect(debtUpdate.remainingBalance).toBe(1850); // 2000 - 150
    expect(debtUpdate.pendingCarryOver).toBe(0);     // carryOver não é mais usado
  });

  test('TOP-UP: uma parcela parcial ACEITA novo pagamento até completar', async () => {
    // Parcela de 200 já com 120 pagos: pode receber mais 80 e virar paga.
    prismaMock.debt.findFirst.mockResolvedValue(makeDebt({ remainingBalance: 1880 }));
    prismaMock.expense.findFirst.mockResolvedValue(makeExpense({ status: 'partial', paidAmount: 120 }));

    await applyPaymentToInstallment(10n, makeExpense({ status: 'partial', paidAmount: 120 }), 80, 'pix');

    const expenseUpdate = prismaMock.expense.update.mock.calls[0][0].data;
    expect(expenseUpdate.paidAmount).toBe(200); // 120 + 80
    expect(expenseUpdate.status).toBe('paid');
  });

  test('pagar o valor exato quita a parcela', async () => {
    prismaMock.debt.findFirst.mockResolvedValue(makeDebt());
    prismaMock.expense.findFirst.mockResolvedValue(makeExpense({ paidAmount: 0 }));

    await applyPaymentToInstallment(10n, makeExpense(), 200, 'pix');

    const expenseUpdate = prismaMock.expense.update.mock.calls[0][0].data;
    expect(expenseUpdate.status).toBe('paid');
  });

  test('pagar a menos numa dívida SEM pagamento flexível é rejeitado', async () => {
    prismaMock.debt.findFirst.mockResolvedValue(makeDebt({ flexiblePayment: false }));
    prismaMock.expense.findFirst.mockResolvedValue(makeExpense({ paidAmount: 0 }));

    await expect(applyPaymentToInstallment(10n, makeExpense(), 150, 'pix'))
      .rejects.toMatchObject({ code: 'EXACT_PAYMENT_REQUIRED' });
  });

  test('pagar MAIS do que falta nesta parcela é rejeitado (o resto fica nas próximas)', async () => {
    prismaMock.debt.findFirst.mockResolvedValue(makeDebt());
    prismaMock.expense.findFirst.mockResolvedValue(makeExpense({ paidAmount: 0 }));

    await expect(applyPaymentToInstallment(10n, makeExpense(), 260, 'pix'))
      .rejects.toMatchObject({ code: 'PAYMENT_ABOVE_INSTALLMENT' });
  });

  test('pagamento que quita a dívida inteira marca como settled', async () => {
    prismaMock.debt.findFirst.mockResolvedValue(makeDebt({ remainingBalance: 200 }));
    prismaMock.expense.findFirst.mockResolvedValue(makeExpense({ paidAmount: 0 }));

    await applyPaymentToInstallment(10n, makeExpense(), 200, 'pix');

    const debtUpdate = prismaMock.debt.update.mock.calls[0][0].data;
    expect(debtUpdate.status).toBe('settled');
  });

  test('parcela TOTALMENTE paga não aceita novo pagamento', async () => {
    prismaMock.debt.findFirst.mockResolvedValue(makeDebt());
    prismaMock.expense.findFirst.mockResolvedValue(makeExpense({ status: 'paid', paidAmount: 200 }));

    await expect(applyPaymentToInstallment(10n, makeExpense({ status: 'paid' }), 50, 'pix'))
      .rejects.toMatchObject({ code: 'INSTALLMENT_ALREADY_PAID' });
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

describe('generateNextInstallment — rolagem do saldo não pago para a parcela atual', () => {
  // Sem parcelas anteriores em aberto por padrão.
  beforeEach(() => { prismaMock.expense.findMany.mockResolvedValue([]); });

  test('sem parcela anterior em aberto: próxima parcela é o valor nominal', async () => {
    const debt = makeDebt({ remainingBalance: 1800 }); // nominal 200, 12x
    prismaMock.expense.count.mockResolvedValue(2);      // 2 geradas, faltam 10

    const created = await generateNextInstallment(debt, { id: 2n });
    expect(created.value).toBe(200);
  });

  test('pagou só parte da parcela anterior: o que faltou é SOMADO à próxima', async () => {
    // Regra do usuário: parcela de 200, pagou 60 -> próxima = 200 + 140.
    const debt = makeDebt({ remainingBalance: 1740 });
    prismaMock.expense.count.mockResolvedValue(2);
    prismaMock.expense.findMany.mockResolvedValue([{ id: 5n, value: 200, paidAmount: 60 }]);

    const created = await generateNextInstallment(debt, { id: 2n });
    expect(created.value).toBe(340); // 200 nominal + 140 atrasado
    // A parcela anterior é fechada: marcada como paga e com value reduzido ao
    // que foi pago (60), pois o restante já está embutido na parcela atual.
    expect(prismaMock.expense.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 5n }, data: { status: 'paid', value: 60 } })
    );
  });

  test('pulou a parcela anterior inteira: valor inteiro é somado à próxima', async () => {
    const debt = makeDebt({ remainingBalance: 1800 });
    prismaMock.expense.count.mockResolvedValue(2);
    prismaMock.expense.findMany.mockResolvedValue([{ id: 5n, value: 200, paidAmount: 0 }]);

    const created = await generateNextInstallment(debt, { id: 2n });
    expect(created.value).toBe(400); // 200 + 200
  });

  test('última parcela carrega TODO o saldo devedor restante', async () => {
    // 11 de 12 geradas -> a próxima é a última (12/12) e fecha o saldo.
    const debt = makeDebt({ remainingBalance: 1500 });
    prismaMock.expense.count.mockResolvedValue(11);
    prismaMock.expense.findMany.mockResolvedValue([{ id: 5n, value: 200, paidAmount: 0 }]);

    const created = await generateNextInstallment(debt, { id: 2n });
    expect(created.value).toBe(1500); // saldo devedor inteiro
  });

  test('plano esgotado: não cria parcela nova (número fixo)', async () => {
    const debt = makeDebt({ remainingBalance: 1000 }); // 12x
    prismaMock.expense.count.mockResolvedValue(12);     // todas já geradas

    const created = await generateNextInstallment(debt, { id: 2n });

    expect(created).toBeNull();
    expect(prismaMock.expense.create).not.toHaveBeenCalled();
  });

  test('saldo devedor zerado encerra a dívida', async () => {
    const debt = makeDebt({ remainingBalance: 0.005 });
    const created = await generateNextInstallment(debt, { id: 2n });
    expect(created).toBeNull();
    expect(prismaMock.debt.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'settled' }) })
    );
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
          oldValueJson: expect.objectContaining({ privacyVersion: 1 }),
          newValueJson: expect.objectContaining({ privacyVersion: 1 }),
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

  test('deleteDebt apaga só as parcelas SEM pagamento (não devolve dinheiro pago)', async () => {
    prismaMock.debt.findFirst.mockResolvedValue({ id: 5n, userId: 10n, status: 'active' });
    prismaMock.debt.update.mockResolvedValue({ id: 5n, status: 'settled' });
    prismaMock.expense.findMany.mockResolvedValue([]); // sem parciais

    await deleteDebt(10n, 5n);

    // Só apaga parcelas com paidAmount 0 — apagar uma parcial devolveria o
    // dinheiro já pago (o saldo conta o paidAmount).
    expect(prismaMock.expense.deleteMany).toHaveBeenCalledWith({
      where: { debtId: 5n, paidAmount: 0, status: { in: ['pending', 'late'] }, month: { status: 'open' } },
    });
  });

  test('deleteDebt FECHA parcelas parciais (preserva o pago, sem deixar órfão)', async () => {
    prismaMock.debt.findFirst.mockResolvedValue({ id: 5n, userId: 10n, status: 'active' });
    prismaMock.debt.update.mockResolvedValue({ id: 5n, status: 'settled' });
    // Uma parcela de 500 com 200 pagos.
    prismaMock.expense.findMany.mockResolvedValue([{ id: 8n, paidAmount: 200 }]);

    await deleteDebt(10n, 5n);

    // Reduz o valor ao que foi pago e marca como paga (não apaga -> não
    // devolve dinheiro; e não sobra parte em aberto).
    expect(prismaMock.expense.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 8n }, data: { value: 200, status: 'paid' } })
    );
  });

  test('dívida de outro usuário (404) não grava audit log nenhum', async () => {
    prismaMock.debt.findFirst.mockResolvedValue(null);

    await expect(updateDebt(10n, 999n, { description: 'x' })).rejects.toMatchObject({ statusCode: 404 });
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });
});
