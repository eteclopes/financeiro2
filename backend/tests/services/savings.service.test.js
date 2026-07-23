const { createPrismaMock } = require('../helpers/prismaMock');

let prismaMock;
jest.mock('../../src/config/prisma', () => {
  const { createPrismaMock } = require('../helpers/prismaMock');
  return createPrismaMock();
});

// pega a MESMA instância que o mock de módulo acima devolveu, para poder
// configurar/inspecionar as chamadas nos testes
prismaMock = require('../../src/config/prisma');

const { installDefaults } = require('../helpers/prismaMock');
beforeEach(() => {
  installDefaults(prismaMock);
  prismaMock.income.aggregate.mockResolvedValue({ _sum: { value: 100000 } });
});

const savingsService = require('../../src/modules/savings/savings.service');

describe('savings.service — deposit/withdraw (fix de condição de corrida)', () => {
  test('depósito sem transações anteriores parte de saldo zero e grava audit log', async () => {
    prismaMock.savingsTransaction.findFirst.mockResolvedValue(null);
    prismaMock.savingsTransaction.create.mockImplementation(({ data }) => Promise.resolve({ id: 1n, ...data }));

    const result = await savingsService.deposit(10n, { value: 100, date: new Date(), observation: null });

    expect(result.balanceAfter).toBe(100);
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ entity: 'savingsTransaction', action: 'deposit' }) })
    );
  });

  test('depósito soma corretamente em cima do último saldo (sem drift de ponto flutuante)', async () => {
    prismaMock.savingsTransaction.findFirst.mockResolvedValue({ balanceAfter: 10.1 });
    prismaMock.savingsTransaction.create.mockImplementation(({ data }) => Promise.resolve({ id: 2n, ...data }));

    const result = await savingsService.deposit(10n, { value: 20.2, date: new Date(), observation: null });

    // 10.10 + 20.20 em JS puro dá 30.299999999999997 — precisa fechar em 30.30
    expect(result.balanceAfter).toBe(30.3);
  });

  test('saque com saldo suficiente é aceito e desconta corretamente', async () => {
    prismaMock.savingsTransaction.findFirst.mockResolvedValue({ balanceAfter: 300 });
    prismaMock.savingsTransaction.create.mockImplementation(({ data }) => Promise.resolve({ id: 3n, ...data }));

    const result = await savingsService.withdraw(10n, { value: 120, date: new Date(), observation: null });

    expect(result.balanceAfter).toBe(180);
  });

  test('saque do saldo exato (dentro da tolerância de 0.009) é aceito, não rejeitado por arredondamento', async () => {
    prismaMock.savingsTransaction.findFirst.mockResolvedValue({ balanceAfter: 50 });
    prismaMock.savingsTransaction.create.mockImplementation(({ data }) => Promise.resolve({ id: 4n, ...data }));

    const result = await savingsService.withdraw(10n, { value: 50, date: new Date(), observation: null });

    expect(result.balanceAfter).toBe(0);
  });

  test('saque maior que o saldo disponível é rejeitado com AppError 409', async () => {
    prismaMock.savingsTransaction.findFirst.mockResolvedValue({ balanceAfter: 50 });

    await expect(
      savingsService.withdraw(10n, { value: 50.5, date: new Date(), observation: null })
    ).rejects.toMatchObject({ statusCode: 409, code: 'INSUFFICIENT_SAVINGS_BALANCE' });

    expect(prismaMock.savingsTransaction.create).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  test('REGRESSÃO: deposit precisa adquirir o lock consultivo por usuário antes de ler o saldo', async () => {
    const order = [];
    prismaMock.$executeRaw.mockImplementation(() => {
      order.push('lock');
      return Promise.resolve();
    });
    prismaMock.savingsTransaction.findFirst.mockImplementation(() => {
      order.push('read');
      return Promise.resolve(null);
    });
    prismaMock.savingsTransaction.create.mockImplementation(({ data }) => {
      order.push('write');
      return Promise.resolve({ id: 5n, ...data });
    });

    await savingsService.deposit(10n, { value: 10, date: new Date(), observation: null });

    // Se algum dia alguém remover o lock (ou movê-lo para depois da leitura),
    // este teste falha — é exatamente o bug corrigido nesta sessão.
    expect(order).toEqual(['lock', 'read', 'read', 'write']);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  test('REGRESSÃO: withdraw também adquire o lock antes de ler o saldo', async () => {
    prismaMock.savingsTransaction.findFirst.mockResolvedValue({ balanceAfter: 100 });
    prismaMock.savingsTransaction.create.mockImplementation(({ data }) => Promise.resolve({ id: 6n, ...data }));

    await savingsService.withdraw(10n, { value: 10, date: new Date(), observation: null });

    expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('savings.service — origin do depósito (REGRESSÃO item 6)', () => {
  test('sem origin informado, assume "balance" (preserva o comportamento de sempre)', async () => {
    prismaMock.savingsTransaction.findFirst.mockResolvedValue(null);
    prismaMock.savingsTransaction.create.mockImplementation(({ data }) => Promise.resolve({ id: 1n, ...data }));

    const result = await savingsService.deposit(10n, { value: 100, date: new Date(), observation: null });

    expect(prismaMock.savingsTransaction.create.mock.calls[0][0].data.origin).toBe('balance');
    expect(result.origin).toBe('balance');
  });

  test('origin=external é gravado como informado', async () => {
    prismaMock.savingsTransaction.findFirst.mockResolvedValue(null);
    prismaMock.savingsTransaction.create.mockImplementation(({ data }) => Promise.resolve({ id: 1n, ...data }));

    await savingsService.deposit(10n, { value: 500, date: new Date(), observation: null, origin: 'external' });

    expect(prismaMock.savingsTransaction.create.mock.calls[0][0].data.origin).toBe('external');
  });
});

describe('getBalanceBreakdown — separa o que saiu do saldo do que foi só informado', () => {
  test('total reservado = soma de balance + external; movedFromBalance só conta origin=balance menos saques', async () => {
    prismaMock.savingsTransaction.findFirst.mockResolvedValue({ balanceAfter: 2000 }); // total reservado (getCurrentBalance)
    prismaMock.savingsTransaction.aggregate
      .mockResolvedValueOnce({ _sum: { value: 500 } })  // deposit origin=balance
      .mockResolvedValueOnce({ _sum: { value: 1500 } }) // deposit origin=external
      .mockResolvedValueOnce({ _sum: { value: 0 } });   // withdraw

    const result = await savingsService.getBalanceBreakdown(10n);

    expect(result).toEqual({ totalReserved: 2000, movedFromBalance: 500, externalReported: 1500 });
  });

  test('saque reduz movedFromBalance (voltou a ser gasto do saldo, independente da origem)', async () => {
    prismaMock.savingsTransaction.findFirst.mockResolvedValue({ balanceAfter: 300 });
    prismaMock.savingsTransaction.aggregate
      .mockResolvedValueOnce({ _sum: { value: 1000 } }) // deposit origin=balance
      .mockResolvedValueOnce({ _sum: { value: 0 } })    // deposit origin=external
      .mockResolvedValueOnce({ _sum: { value: 700 } }); // withdraw

    const result = await savingsService.getBalanceBreakdown(10n);

    expect(result.movedFromBalance).toBe(300); // 1000 - 700
  });
});

describe('savings.service — updateLastTransaction / deleteLastTransaction', () => {

  test('deleteLastTransaction remove quando o id é o do lançamento mais recente', async () => {
    prismaMock.savingsTransaction.findFirst.mockResolvedValue({ id: 9n, userId: 10n, type: 'deposit', value: 50, balanceAfter: 150 });
    prismaMock.savingsTransaction.delete.mockResolvedValue({ id: 9n });

    const result = await savingsService.deleteLastTransaction(10n, 9n);

    expect(prismaMock.savingsTransaction.delete).toHaveBeenCalledWith({ where: { id: 9n } });
    expect(result.id).toBe(9n);
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ entity: 'savingsTransaction', action: 'delete' }) })
    );
  });

  test('deleteLastTransaction rejeita (409) se o id não for o do lançamento mais recente', async () => {
    prismaMock.savingsTransaction.findFirst.mockResolvedValue({ id: 9n, userId: 10n, type: 'deposit', value: 50, balanceAfter: 150 });

    await expect(savingsService.deleteLastTransaction(10n, 3n)).rejects.toMatchObject({
      statusCode: 409,
      code: 'NOT_LAST_SAVINGS_TRANSACTION',
    });
    expect(prismaMock.savingsTransaction.delete).not.toHaveBeenCalled();
  });

  test('deleteLastTransaction rejeita (409) se não houver nenhum lançamento', async () => {
    prismaMock.savingsTransaction.findFirst.mockResolvedValue(null);

    await expect(savingsService.deleteLastTransaction(10n, 9n)).rejects.toMatchObject({
      statusCode: 409,
      code: 'NOT_LAST_SAVINGS_TRANSACTION',
    });
  });

  test('updateLastTransaction recalcula balanceAfter de um depósito editado', async () => {
    // último lançamento: depósito de 50 que levou o saldo a 150 (ou seja, saldo antes era 100)
    prismaMock.savingsTransaction.findFirst.mockResolvedValue({ id: 9n, userId: 10n, type: 'deposit', value: 50, balanceAfter: 150 });
    prismaMock.savingsTransaction.update.mockImplementation(({ data }) => Promise.resolve({ id: 9n, ...data }));

    const result = await savingsService.updateLastTransaction(10n, 9n, { value: 80, date: new Date(), observation: 'corrigido' });

    // saldo antes (100) + novo valor (80) = 180
    expect(result.balanceAfter).toBe(180);
    expect(result.value).toBe(80);
  });

  test('updateLastTransaction recalcula balanceAfter de um saque editado', async () => {
    // último lançamento: saque de 30 que deixou o saldo em 70 (saldo antes era 100)
    prismaMock.savingsTransaction.findFirst.mockResolvedValue({ id: 9n, userId: 10n, type: 'withdraw', value: 30, balanceAfter: 70 });
    prismaMock.savingsTransaction.update.mockImplementation(({ data }) => Promise.resolve({ id: 9n, ...data }));

    const result = await savingsService.updateLastTransaction(10n, 9n, { value: 40, date: new Date(), observation: null });

    // saldo antes (100) - novo valor (40) = 60
    expect(result.balanceAfter).toBe(60);
  });

  test('updateLastTransaction rejeita (409) editar saque para valor maior que o saldo disponível antes dele', async () => {
    prismaMock.savingsTransaction.findFirst.mockResolvedValue({ id: 9n, userId: 10n, type: 'withdraw', value: 30, balanceAfter: 70 });

    // saldo antes era 100 — pedir 150 deve ser rejeitado
    await expect(
      savingsService.updateLastTransaction(10n, 9n, { value: 150, date: new Date(), observation: null })
    ).rejects.toMatchObject({ statusCode: 409, code: 'INSUFFICIENT_SAVINGS_BALANCE' });
    expect(prismaMock.savingsTransaction.update).not.toHaveBeenCalled();
  });

  test('updateLastTransaction rejeita (409) se o id não for o do lançamento mais recente', async () => {
    prismaMock.savingsTransaction.findFirst.mockResolvedValue({ id: 9n, userId: 10n, type: 'deposit', value: 50, balanceAfter: 150 });

    await expect(
      savingsService.updateLastTransaction(10n, 2n, { value: 10, date: new Date(), observation: null })
    ).rejects.toMatchObject({ statusCode: 409, code: 'NOT_LAST_SAVINGS_TRANSACTION' });
    expect(prismaMock.savingsTransaction.update).not.toHaveBeenCalled();
  });
});
