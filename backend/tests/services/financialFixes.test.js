jest.mock('../../src/config/prisma', () => require('../helpers/prismaMock').createPrismaMock());

const prismaMock = require('../../src/config/prisma');
const { installDefaults } = require('../helpers/prismaMock');
const debtsService = require('../../src/modules/debts/debts.service');
const { normalizePaymentMethod, incomeOriginFor } = require('../../src/utils/paymentMethods');
const { getMonthFacts, normalizeFacts } = require('../../src/modules/months/monthFacts.service');

beforeEach(() => installDefaults(prismaMock));

const MONTH = { id: 50n, month: 9, year: 2026 };

// ---------------------------------------------------------------
// F-02 — dívida NUNCA é encerrada com saldo devedor em aberto
// ---------------------------------------------------------------
describe('generateNextInstallment — quitação só com saldo zero (F-02)', () => {
  test('plano original esgotado + saldo restante NÃO gera parcela nova (fica para renegociar/pagar quando quiser)', async () => {
    const debt = {
      id: 1n, userId: 10n, description: 'Notebook', categoryId: 3n,
      status: 'active', installmentsCount: 12, installmentValue: 100,
      remainingBalance: 250, pendingCarryOver: 0, dueDay: 10,
    };
    prismaMock.expense.findMany.mockResolvedValue([]);

    const created = await debtsService.generateNextInstallment(
      debt, MONTH, prismaMock, { installmentsGenerated: 12 }
    );

    // Número de parcelas é FIXO: nada novo é criado. A última fica em aberto
    // com o valor acumulado e é levada adiante como atrasada.
    expect(created).toBeNull();
    expect(prismaMock.expense.create).not.toHaveBeenCalled();
  });

  test('saldo devedor zerado (dentro da tolerância de centavos) encerra a dívida', async () => {
    const debt = {
      id: 1n, userId: 10n, description: 'Notebook', categoryId: 3n,
      status: 'active', installmentsCount: 12, installmentValue: 100,
      remainingBalance: 0.005, pendingCarryOver: 0, dueDay: 10,
    };

    const created = await debtsService.generateNextInstallment(debt, MONTH, prismaMock, { installmentsGenerated: 5 });

    expect(created).toBeNull();
    expect(prismaMock.debt.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'settled', remainingBalance: 0 }) })
    );
    expect(prismaMock.expense.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------
// F-29 — indicadores reais de dívida (nunca "0 parcelas" com saldo)
// ---------------------------------------------------------------
describe('getDebtIndicators — números reais para o Dashboard (F-29)', () => {
  test('dívida com saldo devedor nunca reporta 0 parcelas restantes', async () => {
    prismaMock.debt.findMany.mockResolvedValue([
      { id: 1n, description: 'Notebook', remainingBalance: 250, installmentValue: 100, installmentsCount: 12, dueDay: 10 },
    ]);
    // Nenhuma parcela pendente gerada ainda — era exatamente o caso em que
    // a tela mostrava "Dívida ativa R$ 250 — 0 parcelas".
    prismaMock.expense.findMany.mockResolvedValue([]);

    const result = await debtsService.getDebtIndicators(10n, prismaMock);

    expect(result.activeDebtsCount).toBe(1);
    expect(result.totalRemainingBalance).toBe(250);
    expect(result.remainingInstallments).toBeGreaterThan(0);
    expect(result.remainingInstallments).toBe(3); // ceil(250 / 100)
  });

  test('sem dívidas ativas devolve zeros coerentes', async () => {
    prismaMock.debt.findMany.mockResolvedValue([]);
    const result = await debtsService.getDebtIndicators(10n, prismaMock);
    expect(result).toEqual({
      activeDebtsCount: 0, totalRemainingBalance: 0,
      remainingInstallments: 0, nextInstallment: null,
    });
  });

  test('dívida com saldo residual de centavos não conta como ativa', async () => {
    prismaMock.debt.findMany.mockResolvedValue([
      { id: 1n, description: 'X', remainingBalance: 0.004, installmentValue: 100, installmentsCount: 3, dueDay: 5 },
    ]);
    const result = await debtsService.getDebtIndicators(10n, prismaMock);
    expect(result.activeDebtsCount).toBe(0);
  });
});

describe('applyPaymentToInstallment — pagamento acima do saldo devedor', () => {
  test('recusa valor maior que o saldo devedor em vez de absorvê-lo em silêncio', async () => {
    prismaMock.expense.findFirst.mockResolvedValue({
      id: 7n, userId: 10n, debtId: 1n, value: 100, paidAmount: 0, status: 'pending', deletedAt: null,
    });
    prismaMock.debt.findFirst.mockResolvedValue({
      id: 1n, userId: 10n, remainingBalance: 100, pendingCarryOver: 0, flexiblePayment: true,
    });

    // Paga 500 numa parcela onde só faltam 100 -> recusado (o resto fica nas próximas).
    await expect(
      debtsService.applyPaymentToInstallment(10n, { id: 7n }, 500, 'debit')
    ).rejects.toMatchObject({ code: 'PAYMENT_ABOVE_INSTALLMENT' });
  });
});

// ---------------------------------------------------------------
// F-04 — despesa fixa no cartão não pode ser contada duas vezes
// ---------------------------------------------------------------
describe('getActiveRecurringTotals — sem dupla contagem de fixa no cartão (F-04)', () => {
  test('templates pagos com crédito ficam fora do total de despesas fixas', async () => {
    const projections = require('../../src/modules/projections/projections.service');
    prismaMock.incomeTemplate.aggregate.mockResolvedValue({ _sum: { value: 5000 } });
    prismaMock.fixedExpenseTemplate.aggregate
      .mockResolvedValueOnce({ _sum: { value: 800 } })   // não-crédito
      .mockResolvedValueOnce({ _sum: { value: 300 } });  // crédito

    const totals = await projections.getActiveRecurringTotals(10n);

    // 800, não 1100: os 300 do cartão já entram via cardSchedule.
    expect(totals.fixedExpenses).toBe(800);
    expect(totals.fixedExpensesOnCard).toBe(300);
    const whereNaoCredito = prismaMock.fixedExpenseTemplate.aggregate.mock.calls[0][0].where;
    expect(whereNaoCredito.paymentMethod).toEqual({ not: 'credit' });
  });
});

// ---------------------------------------------------------------
// §12 — métodos de pagamento canônicos
// ---------------------------------------------------------------
describe('normalizePaymentMethod — três origens com efeito distinto (§12)', () => {
  test.each(['pix', 'transfer', 'debit'])('%s vira o canônico debit (saldo da conta)', (method) => {
    expect(normalizePaymentMethod(method)).toBe('debit');
  });

  test('dinheiro físico e crédito são preservados', () => {
    expect(normalizePaymentMethod('cash')).toBe('cash');
    expect(normalizePaymentMethod('credit')).toBe('credit');
  });

  test('crédito é rebaixado para saldo quando não é permitido (receitas)', () => {
    expect(normalizePaymentMethod('credit', { allowCredit: false })).toBe('debit');
  });

  test('valor desconhecido nunca quebra: cai no saldo da conta', () => {
    expect(normalizePaymentMethod(undefined)).toBe('debit');
    expect(normalizePaymentMethod('boleto')).toBe('debit');
  });

  test('origem da receita acompanha o método', () => {
    expect(incomeOriginFor('cash')).toBe('physical');
    expect(incomeOriginFor('debit')).toBe('digital');
  });
});

// ---------------------------------------------------------------
// §10 — mês fechado usa snapshot congelado em TODAS as telas
// ---------------------------------------------------------------
describe('getMonthFacts — fonte única de verdade (§10)', () => {
  test('mês fechado com snapshot devolve o retrato congelado, sem recalcular', async () => {
    const month = {
      id: 31n, month: 7, year: 2026, status: 'closed',
      snapshotVersion: 1,
      financialSnapshot: { incomeTotal: 2060, currentBalance: 1500, expensesPaid: 560 },
    };

    const facts = await getMonthFacts(10n, month, prismaMock);

    expect(facts.source).toBe('snapshot');
    expect(facts.isFrozen).toBe(true);
    expect(facts.incomeTotal).toBe(2060);
    // Nenhuma agregação foi disparada: o retrato veio do JSON já carregado.
    expect(prismaMock.income.aggregate).not.toHaveBeenCalled();
  });

  test('mês aberto é calculado ao vivo', async () => {
    const month = { id: 32n, month: 8, year: 2026, status: 'open', financialSnapshot: null };
    const facts = await getMonthFacts(10n, month, prismaMock);
    expect(facts.source).toBe('live');
    expect(facts.isFrozen).toBe(false);
    expect(prismaMock.income.aggregate).toHaveBeenCalled();
  });

  test('mês fechado SEM snapshot é calculado, mas marcado como não congelado', async () => {
    const month = { id: 33n, month: 6, year: 2026, status: 'closed', financialSnapshot: null };
    const facts = await getMonthFacts(10n, month, prismaMock);
    expect(facts.isFrozen).toBe(false);
    expect(facts.missingSnapshot).toBe(true);
  });
});

describe('normalizeFacts — snapshot antigo ou corrompido não quebra a tela', () => {
  test('JSON incompleto recebe zeros em vez de NaN/undefined', () => {
    const facts = normalizeFacts({ incomeTotal: 100, source: 'snapshot', isFrozen: true });
    expect(facts.incomeTotal).toBe(100);
    expect(facts.savingsBalance).toBe(0);
    expect(facts.totalActiveDebt).toBe(0);
    expect(Number.isFinite(facts.projectedBalance)).toBe(true);
  });

  test('JSON inválido (null) devolve estrutura completa zerada', () => {
    const facts = normalizeFacts(null);
    expect(facts.currentBalance).toBe(0);
    expect(facts.pendingExpensesCount).toBe(0);
  });

  test('valores não numéricos são descartados em vez de virar NaN', () => {
    const facts = normalizeFacts({ currentBalance: 'quebrado', incomeTotal: null });
    expect(facts.currentBalance).toBe(0);
    expect(facts.incomeTotal).toBe(0);
  });
});

// ---------------------------------------------------------------
// Cenário do usuário: não pagar por vários meses NÃO pode estourar o
// número de parcelas (dupla contagem). Quando as parcelas em aberto já
// cobrem o saldo devedor, nenhuma nova é gerada.
// ---------------------------------------------------------------
describe('generateNextInstallment — não gera parcela em excesso quando já está tudo lançado', () => {
  test('parcelas antigas em aberto ROLAM para a parcela extra (sem dobrar a dívida)', async () => {
    const debt = {
      id: 1n, userId: 10n, description: 'TV', categoryId: 3n,
      status: 'active', installmentsCount: 4, installmentValue: 100,
      remainingBalance: 400, pendingCarryOver: 0, dueDay: 10,
    };
    // 4 parcelas de 100 em aberto em meses anteriores (nada pago).
    prismaMock.expense.findMany.mockResolvedValue([
      { id: 1n, value: 100, paidAmount: 0 }, { id: 2n, value: 100, paidAmount: 0 },
      { id: 3n, value: 100, paidAmount: 0 }, { id: 4n, value: 100, paidAmount: 0 },
    ]);

    const created = await debtsService.generateNextInstallment(debt, MONTH, prismaMock, { installmentsGenerated: 4 });

    // Plano esgotado: NÃO cria parcela nova. A última segue em aberto com o
    // valor acumulado e é levada adiante como atrasada (ver arrasto).
    expect(created).toBeNull();
    expect(prismaMock.expense.create).not.toHaveBeenCalled();
  });

  test('há saldo ainda não coberto por parcelas => gera só o que falta', async () => {
    const debt = {
      id: 1n, userId: 10n, description: 'TV', categoryId: 3n,
      status: 'active', installmentsCount: 4, installmentValue: 100,
      remainingBalance: 400, pendingCarryOver: 0, dueDay: 10,
    };
    // Só 1 parcela de 100 lançada; faltam 300 sem parcela.
    prismaMock.expense.aggregate.mockResolvedValue({ _sum: { value: 100, paidAmount: 0 } });

    const created = await debtsService.generateNextInstallment(debt, MONTH, prismaMock, { installmentsGenerated: 1 });

    expect(created).not.toBeNull();
    // Cobra a parcela nominal (100), nunca mais do que os 300 descobertos.
    expect(prismaMock.expense.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ value: 100 }) })
    );
  });
});

// ===============================================================
// FLUXO COMPLETO do cenário do usuário: dívida 2000 em 4x de 500,
// pagando parcial a cada mês. Verifica que a parcela seguinte
// acumula o não pago e que a dívida NUNCA fica sem parcela pagável.
// ===============================================================
describe('Dívida prioridade — fluxo de pagamento parcial mês a mês (cenário do usuário)', () => {
  const MES = { id: 60n, month: 10, year: 2026 };

  function makeDebtState(remaining, installmentsCount = 4) {
    return {
      id: 1n, userId: 10n, description: 'Compra', categoryId: 3n,
      status: 'active', installmentsCount, installmentValue: 500,
      remainingBalance: remaining, pendingCarryOver: 0, dueDay: 10,
    };
  }

  test('a próxima parcela acumula o que não foi pago na anterior (500 -> 900 -> 1200 -> última = saldo)', async () => {
    // Mês 1 fecha: 1ª parcela (500) foi paga só 100 -> falta 400.
    prismaMock.expense.count.mockResolvedValue(1);
    prismaMock.expense.findMany.mockResolvedValue([{ id: 5n, value: 500, paidAmount: 100 }]);
    let created = await debtsService.generateNextInstallment(makeDebtState(1900), MES, prismaMock, { installmentsGenerated: 1 });
    expect(created.value).toBe(900); // 500 + 400

    // Mês 2 fecha: 2ª (900) foi paga 200 -> falta 700.
    prismaMock.expense.count.mockResolvedValue(2);
    prismaMock.expense.findMany.mockResolvedValue([{ id: 6n, value: 900, paidAmount: 200 }]);
    created = await debtsService.generateNextInstallment(makeDebtState(1700), MES, prismaMock, { installmentsGenerated: 2 });
    expect(created.value).toBe(1200); // 500 + 700

    // Mês 3 fecha: 3ª (1200) foi paga 200 -> falta 1000. A 4ª é a ÚLTIMA:
    // carrega TODO o saldo devedor (1500).
    prismaMock.expense.count.mockResolvedValue(3);
    prismaMock.expense.findMany.mockResolvedValue([{ id: 7n, value: 1200, paidAmount: 200 }]);
    created = await debtsService.generateNextInstallment(makeDebtState(1500), MES, prismaMock, { installmentsGenerated: 3 });
    expect(created.value).toBe(1500); // última = saldo devedor inteiro
  });

  test('plano esgotado: número de parcelas é FIXO, nada novo é criado', async () => {
    // 4 de 4 geradas, ainda deve 1500 (acumulado na última).
    prismaMock.expense.count.mockResolvedValue(4);
    prismaMock.expense.findMany.mockResolvedValue([]);
    const created = await debtsService.generateNextInstallment(makeDebtState(1500), MES, prismaMock, { installmentsGenerated: 4 });

    // A 4ª permanece em aberto com o valor acumulado; o arrasto a mostra
    // como atrasada no mês corrente e ela pode ser paga a qualquer momento.
    // Parcelar de novo só via renegociação, se o usuário quiser.
    expect(created).toBeNull();
    expect(prismaMock.expense.create).not.toHaveBeenCalled();
  });
});

describe('deleteDebt — parciais são fechadas sem devolver dinheiro pago', () => {
  test('apaga só as não pagas e fecha a parcial (preservando o paidAmount)', async () => {
    prismaMock.debt.findFirst.mockResolvedValue({ id: 1n, userId: 10n, remainingBalance: 300, status: 'active' });
    prismaMock.expense.findMany.mockResolvedValue([{ id: 8n, paidAmount: 200 }]);

    await debtsService.deleteDebt(10n, 1n);

    // deleteMany apaga só parcelas sem pagamento.
    const where = prismaMock.expense.deleteMany.mock.calls[0][0].where;
    expect(where.paidAmount).toBe(0);
    // a parcial é fechada (value = pago, status paid), não apagada.
    expect(prismaMock.expense.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 8n }, data: { value: 200, status: 'paid' } })
    );
  });
});

describe('renegotiateDebt — parcial é fechada (não devolve dinheiro)', () => {
  test('reparcela o saldo e fecha a parcela parcial em vez de apagá-la', async () => {
    prismaMock.debt.findFirst.mockResolvedValue({ id: 1n, userId: 10n, status: 'active', remainingBalance: 900, description: 'X', categoryId: 3n, dueDay: 10 });
    prismaMock.month.findFirst.mockResolvedValue({ id: 60n, month: 10, year: 2026, status: 'open' });
    // uma parcela em aberto parcial (paidAmount 100) e uma pendente (0).
    prismaMock.expense.findMany.mockResolvedValue([
      { id: 8n, paidAmount: 100 },
      { id: 9n, paidAmount: 0 },
    ]);
    prismaMock.expense.count.mockResolvedValue(3);

    await debtsService.renegotiateDebt(10n, 1n, { installments: 3, monthId: 60n });

    // a parcial (8) é fechada, a pendente (9) é apagada.
    expect(prismaMock.expense.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 8n }, data: expect.objectContaining({ status: 'paid', value: 100 }) })
    );
    expect(prismaMock.expense.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 9n }, data: { deletedAt: expect.anything() } })
    );
  });
});
