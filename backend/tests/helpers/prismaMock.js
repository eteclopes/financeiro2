/**
 * Mock manual do client do Prisma — de propósito, NÃO usa jest-mock-extended
 * nem o @prisma/client real. Neste ambiente de sandbox não há acesso de rede
 * para baixar o engine do Prisma (`prisma generate` falha), e o
 * `config/prisma.js` real faz `new PrismaClient()` na primeira linha — ou
 * seja, qualquer teste que dê `require()` num service (mesmo só para pegar
 * uma função pura de dentro dele) derrubaria o processo se este mock não
 * existisse. Todo teste que importa um service precisa mockar
 * `src/config/prisma` com este objeto ANTES do primeiro require do service.
 *
 * Lista de métodos gerada a partir de um grep real em todos os arquivos de
 * services cobertos por teste (`grep -rhoE "(prisma|tx|client)\.[a-zA-Z]+\.[a-zA-Z]+\("`),
 * não digitada de memória — reduz a chance de esquecer um método usado.
 *
 * IMPORTANTE: com `resetMocks: true` (jest.config.js), toda implementação de
 * jest.fn() é apagada antes de CADA teste — inclusive as configuradas aqui.
 * Por isso `installDefaults(mock)` existe separado de `createPrismaMock()`:
 * todo arquivo de teste que precisa do comportamento padrão (ex.:
 * `$transaction` de fato chamando o callback) deve chamar
 * `installDefaults(prismaMock)` num `beforeEach`.
 */
function modelMock(methods) {
  return Object.fromEntries(methods.map((m) => [m, jest.fn()]));
}

function createPrismaMock() {
  const mock = {
    user: modelMock(['findUnique', 'findFirst', 'findMany', 'create', 'update', 'updateMany', 'upsert', 'count', 'deleteMany']),
    auditLog: modelMock(['create', 'count', 'findMany']),
    savingsBucket: modelMock(['findFirst', 'findMany', 'create', 'update']),
    savingsTransaction: modelMock(['findFirst', 'findMany', 'create', 'update', 'delete', 'aggregate']),
    card: modelMock(['findMany', 'findFirst', 'findUnique', 'create', 'update', 'delete', 'count']),
    cardInvoice: modelMock(['findUnique', 'findFirst', 'findMany', 'create', 'createMany', 'update', 'updateMany', 'count', 'delete', 'deleteMany']),
    cardPurchase: modelMock(['create', 'findMany', 'groupBy', 'deleteMany']),
    expense: modelMock(['findMany', 'findFirst', 'aggregate', 'groupBy', 'count', 'update', 'updateMany', 'create', 'createMany', 'delete', 'deleteMany']),
    income: modelMock(['aggregate', 'groupBy', 'count', 'create', 'createMany', 'findFirst', 'findMany', 'update', 'updateMany', 'delete', 'deleteMany']),
    incomeTemplate: modelMock(['count', 'findMany', 'aggregate', 'create', 'createMany', 'update', 'updateMany', 'findFirst', 'deleteMany']),
    fixedExpenseTemplate: modelMock(['count', 'findMany', 'aggregate', 'create', 'createMany', 'update', 'updateMany', 'delete', 'deleteMany', 'findFirst']),
    debt: modelMock(['findMany', 'findFirst', 'aggregate', 'create', 'createMany', 'update', 'count', 'deleteMany']),
    category: modelMock(['findMany', 'findFirst', 'create', 'createMany', 'update', 'delete']),
    categoryBudget: modelMock(['findMany', 'createMany', 'upsert', 'deleteMany']),
    goal: modelMock(['findMany', 'create', 'findFirst', 'update', 'count']),
    goalContribution: modelMock(['create', 'findMany', 'aggregate', 'deleteMany']),
    simulation: modelMock(['findFirst', 'findMany', 'create', 'update', 'delete']),
    simulationResult: modelMock(['createMany']),
    simulationWorkspace: modelMock(['findUnique', 'findFirst', 'findMany', 'create', 'update', 'updateMany', 'delete', 'deleteMany', 'count']),
    monthSnapshotVersion: modelMock(['create', 'deleteMany']),
    financialHealthScore: modelMock(['findFirst', 'findUnique', 'findMany', 'upsert', 'deleteMany']),
    alert: modelMock(['findMany', 'update', 'upsert', 'deleteMany']),
    month: modelMock(['findFirst', 'findUnique', 'findMany', 'create', 'createMany', 'update', 'updateMany', 'count']),
    refreshToken: modelMock(['findUnique', 'create', 'update', 'updateMany', 'deleteMany']),
    passwordReset: modelMock(['findFirst', 'findUnique', 'create', 'update', 'updateMany', 'delete', 'deleteMany']),
    billingPurchase: modelMock(['findUnique', 'findFirst', 'upsert', 'update', 'updateMany']),
    stripeEvent: modelMock(['findUnique', 'create']),
    dashboardPreference: modelMock(['findUnique', 'upsert']),
    automationSetting: modelMock(['findUnique', 'upsert', 'create', 'update']),
    $transaction: jest.fn(),
    $executeRaw: jest.fn(),
    $executeRawUnsafe: jest.fn(),
    $queryRaw: jest.fn(),
  };

  installDefaults(mock);
  return mock;
}

/**
 * (Re)instala os comportamentos padrão ("infraestrutura", não dado de
 * teste): $transaction de fato executa o callback recebido (passando o
 * próprio mock como `tx`), e as leituras agregadas mais comuns respondem
 * com "nada encontrado" (soma null, lista vazia) em vez de `undefined` —
 * assim um teste que não usa uma dessas chamadas não quebra por engano só
 * por não tê-la configurado explicitamente.
 */
function installDefaults(mock) {
  mock.$transaction.mockImplementation((arg) => (typeof arg === 'function' ? arg(mock) : Promise.all(arg)));
  mock.$executeRaw.mockResolvedValue(undefined);
  mock.$executeRawUnsafe.mockResolvedValue(undefined);
  mock.$queryRaw.mockResolvedValue([]);

  mock.user.findUnique.mockResolvedValue({
    id: 1n,
    email: 'teste@teste.com',
    plan: 'basic',
    planSource: 'basic',
    planGrantedAt: null,
    planExpiresAt: null,
    stripeCustomerId: null,
  });
  mock.user.findFirst.mockResolvedValue(null);
  mock.user.findMany.mockResolvedValue([]);
  mock.user.count.mockResolvedValue(0);
  mock.user.updateMany.mockResolvedValue({ count: 0 });
  mock.user.deleteMany.mockResolvedValue({ count: 0 });
  mock.simulationWorkspace.findUnique.mockResolvedValue(null);
  mock.simulationWorkspace.findFirst.mockResolvedValue(null);
  mock.simulationWorkspace.findMany.mockResolvedValue([]);
  mock.simulationWorkspace.count.mockResolvedValue(0);
  mock.simulationWorkspace.updateMany.mockResolvedValue({ count: 0 });
  mock.categoryBudget.findMany.mockResolvedValue([]);
  mock.categoryBudget.createMany.mockResolvedValue({ count: 0 });
  mock.categoryBudget.deleteMany.mockResolvedValue({ count: 0 });
  mock.monthSnapshotVersion.deleteMany.mockResolvedValue({ count: 0 });
  mock.card.count.mockResolvedValue(0);
  mock.card.findMany.mockResolvedValue([]);
  mock.billingPurchase.findUnique.mockResolvedValue(null);
  mock.billingPurchase.findFirst.mockResolvedValue(null);
  mock.billingPurchase.upsert.mockImplementation(({ create, update }) => Promise.resolve({ id: 444n, ...create, ...update }));
  mock.billingPurchase.update.mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data }));
  mock.billingPurchase.updateMany.mockResolvedValue({ count: 0 });
  mock.stripeEvent.findUnique.mockResolvedValue(null);
  mock.stripeEvent.create.mockImplementation(({ data }) => Promise.resolve({ id: 445n, ...data }));
  mock.dashboardPreference.findUnique.mockResolvedValue(null);
  mock.dashboardPreference.upsert.mockImplementation(({ create, update }) => Promise.resolve({ ...create, ...update }));
  mock.automationSetting.findUnique.mockResolvedValue(null);
  mock.automationSetting.upsert.mockImplementation(({ create, update }) => Promise.resolve({ ...create, ...update }));

  mock.expense.findMany.mockResolvedValue([]);
  mock.expense.aggregate.mockResolvedValue({ _sum: { value: null, paidAmount: null } });
  mock.expense.groupBy.mockResolvedValue([]);
  mock.expense.count.mockResolvedValue(0);
  mock.expense.create.mockImplementation(({ data }) => Promise.resolve({ id: 999n, ...data }));
  mock.expense.createMany.mockImplementation(({ data }) => Promise.resolve({ count: data.length }));
  mock.expense.delete.mockImplementation(({ where }) => Promise.resolve({ id: where.id }));
  mock.income.findMany.mockResolvedValue([]);
  mock.income.aggregate.mockResolvedValue({ _sum: { value: null } });
  mock.income.groupBy.mockResolvedValue([]);
  mock.income.count.mockResolvedValue(0);
  mock.income.create.mockImplementation(({ data }) => Promise.resolve({ id: 666n, ...data }));
  mock.income.createMany.mockImplementation(({ data }) => Promise.resolve({ count: data.length }));
  mock.income.update.mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data }));
  mock.income.delete.mockImplementation(({ where }) => Promise.resolve({ id: where.id }));
  mock.incomeTemplate.count.mockResolvedValue(0);
  mock.incomeTemplate.findMany.mockResolvedValue([]);
  mock.incomeTemplate.aggregate.mockResolvedValue({ _sum: { value: null } });
  mock.incomeTemplate.create.mockImplementation(({ data }) => Promise.resolve({ id: 667n, ...data }));
  mock.incomeTemplate.update.mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data }));
  mock.fixedExpenseTemplate.count.mockResolvedValue(0);
  mock.fixedExpenseTemplate.findMany.mockResolvedValue([]);
  mock.fixedExpenseTemplate.aggregate.mockResolvedValue({ _sum: { value: null } });
  mock.fixedExpenseTemplate.create.mockImplementation(({ data }) => Promise.resolve({ id: 777n, ...data }));
  mock.fixedExpenseTemplate.update.mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data }));
  mock.fixedExpenseTemplate.updateMany.mockResolvedValue({ count: 0 });
  mock.fixedExpenseTemplate.delete.mockImplementation(({ where }) => Promise.resolve({ id: where.id }));

  mock.debt.findMany.mockResolvedValue([]);
  mock.debt.aggregate.mockResolvedValue({ _sum: { remainingBalance: null, totalValue: null } });
  mock.debt.count.mockResolvedValue(0);
  mock.debt.create.mockImplementation(({ data }) => Promise.resolve({ id: 555n, ...data }));
  mock.category.findMany.mockResolvedValue([]);
  mock.category.create.mockImplementation(({ data }) => Promise.resolve({ id: 222n, ...data }));
  mock.category.update.mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data }));
  mock.category.delete.mockImplementation(({ where }) => Promise.resolve({ id: where.id }));
  mock.goal.findMany.mockResolvedValue([]);
  mock.goal.count.mockResolvedValue(0);
  mock.goalContribution.findMany.mockResolvedValue([]);
  mock.goalContribution.aggregate.mockResolvedValue({ _sum: { value: null } });
  mock.month.findMany.mockResolvedValue([]);
  mock.month.create.mockImplementation(({ data }) => Promise.resolve({ id: 333n, ...data }));
  mock.savingsTransaction.aggregate.mockResolvedValue({ _sum: { value: null } });
  mock.savingsTransaction.findMany.mockResolvedValue([]);
  mock.savingsBucket.findFirst.mockResolvedValue({
    id: 700n,
    userId: 1n,
    kind: 'general',
    name: null,
    targetValue: null,
    isDefault: true,
    isArchived: false,
  });
  mock.savingsBucket.findMany.mockResolvedValue([]);
  mock.savingsBucket.create.mockImplementation(({ data }) => Promise.resolve({ id: 700n, ...data }));
  mock.savingsBucket.update.mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data }));
  mock.auditLog.create.mockResolvedValue({});
  mock.refreshToken.deleteMany.mockResolvedValue({ count: 0 });
  mock.refreshToken.updateMany.mockResolvedValue({ count: 1 });
  mock.passwordReset.deleteMany.mockResolvedValue({ count: 0 });
  mock.passwordReset.updateMany.mockResolvedValue({ count: 0 });
  mock.simulationResult.createMany.mockResolvedValue({ count: 0 });
  mock.financialHealthScore.findFirst.mockResolvedValue(null);
  mock.financialHealthScore.findUnique.mockResolvedValue(null);
  mock.financialHealthScore.findMany.mockResolvedValue([]);
  mock.financialHealthScore.deleteMany.mockResolvedValue({ count: 0 });
  mock.financialHealthScore.upsert.mockResolvedValue({});
  mock.cardInvoice.count.mockResolvedValue(0);
  mock.cardInvoice.findMany.mockResolvedValue([]);
  mock.cardInvoice.update.mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data }));
  mock.cardInvoice.updateMany.mockResolvedValue({ count: 1 });
  mock.cardInvoice.create.mockImplementation(({ data }) => Promise.resolve({ id: 888n, status: 'open', ...data }));
  mock.cardPurchase.groupBy.mockResolvedValue([]);
  mock.cardPurchase.findMany.mockResolvedValue([]);
  mock.alert.findMany.mockResolvedValue([]);
  mock.alert.deleteMany.mockResolvedValue({ count: 0 });
  mock.alert.update.mockResolvedValue({});
  mock.alert.upsert.mockResolvedValue({});
}

module.exports = { createPrismaMock, installDefaults };
