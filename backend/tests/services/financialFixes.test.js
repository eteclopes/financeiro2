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
  test('plano original esgotado mas com saldo devedor gera parcela RESIDUAL em vez de apagar a dívida', async () => {
    const debt = {
      id: 1n, userId: 10n, description: 'Notebook', categoryId: 3n,
      status: 'active', installmentsCount: 12, installmentValue: 100,
      remainingBalance: 250, pendingCarryOver: 0, dueDay: 10,
    };
    prismaMock.expense.create.mockResolvedValue({ id: 99n });

    const created = await debtsService.generateNextInstallment(
      debt, MONTH, prismaMock, { installmentsGenerated: 12 }
    );

    expect(created).not.toBeNull();
    // Não pode ter sido marcada como quitada.
    const updateData = prismaMock.debt.update.mock.calls[0][0].data;
    expect(updateData.status).toBeUndefined();
    // O total de parcelas é estendido para o rótulo continuar coerente.
    expect(updateData.installmentsCount).toBe(13);
    expect(prismaMock.expense.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ value: 100, debtId: 1n }) })
    );
  });

  test('parcela residual nunca cobra mais que o saldo devedor restante', async () => {
    const debt = {
      id: 1n, userId: 10n, description: 'Notebook', categoryId: 3n,
      status: 'active', installmentsCount: 12, installmentValue: 100,
      remainingBalance: 30, pendingCarryOver: 0, dueDay: 10,
    };
    prismaMock.expense.create.mockResolvedValue({ id: 99n });

    await debtsService.generateNextInstallment(debt, MONTH, prismaMock, { installmentsGenerated: 12 });

    expect(prismaMock.expense.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ value: 30 }) })
    );
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
      id: 7n, userId: 10n, debtId: 1n, value: 100, status: 'pending', deletedAt: null,
    });
    prismaMock.debt.findFirst.mockResolvedValue({
      id: 1n, userId: 10n, remainingBalance: 100, pendingCarryOver: 0, flexiblePayment: true,
    });

    await expect(
      debtsService.applyPaymentToInstallment(10n, { id: 7n }, 500, 'debit')
    ).rejects.toMatchObject({ code: 'PAYMENT_ABOVE_DEBT_BALANCE' });
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
