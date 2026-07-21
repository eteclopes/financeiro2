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
    user: modelMock(['findUnique', 'create', 'update']),
    auditLog: modelMock(['create']),
    savingsTransaction: modelMock(['findFirst', 'findMany', 'create', 'update', 'delete', 'aggregate']),
    card: modelMock(['findMany', 'findFirst', 'findUnique', 'create', 'update', 'delete']),
    cardInvoice: modelMock(['findUnique', 'findFirst', 'findMany', 'create', 'update', 'updateMany', 'count', 'deleteMany']),
    cardPurchase: modelMock(['create', 'findMany', 'groupBy', 'deleteMany']),
    expense: modelMock(['findMany', 'findFirst', 'aggregate', 'groupBy', 'count', 'update', 'updateMany', 'create', 'delete', 'deleteMany']),
    income: modelMock(['aggregate', 'groupBy', 'create', 'findFirst', 'findMany', 'update', 'delete']),
    incomeTemplate: modelMock(['count', 'findMany', 'aggregate', 'create', 'update', 'findFirst']),
    fixedExpenseTemplate: modelMock(['count', 'findMany', 'aggregate', 'create', 'update', 'updateMany', 'delete', 'findFirst']),
    debt: modelMock(['findMany', 'findFirst', 'aggregate', 'create', 'update', 'count']),
    category: modelMock(['findMany', 'findFirst', 'update']),
    goal: modelMock(['findMany', 'create', 'findFirst', 'update', 'count']),
    goalContribution: modelMock(['create', 'findMany', 'aggregate']),
    simulation: modelMock(['findFirst', 'findMany', 'create', 'update', 'delete']),
    alert: modelMock(['findMany', 'update', 'upsert']),
    month: modelMock(['findFirst', 'findUnique', 'findMany', 'create', 'update']),
    refreshToken: modelMock(['findUnique', 'create', 'update', 'updateMany']),
    passwordReset: modelMock(['findFirst', 'findUnique', 'create', 'update']),
    $transaction: jest.fn(),
    $executeRaw: jest.fn(),
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
  mock.$queryRaw.mockResolvedValue([]);

  mock.expense.findMany.mockResolvedValue([]);
  mock.expense.aggregate.mockResolvedValue({ _sum: { value: null, paidAmount: null } });
  mock.expense.groupBy.mockResolvedValue([]);
  mock.expense.count.mockResolvedValue(0);
  mock.expense.create.mockImplementation(({ data }) => Promise.resolve({ id: 999n, ...data }));
  mock.expense.delete.mockImplementation(({ where }) => Promise.resolve({ id: where.id }));
  mock.income.aggregate.mockResolvedValue({ _sum: { value: null } });
  mock.income.groupBy.mockResolvedValue([]);
  mock.income.create.mockImplementation(({ data }) => Promise.resolve({ id: 666n, ...data }));
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
  mock.goal.findMany.mockResolvedValue([]);
  mock.goal.count.mockResolvedValue(0);
  mock.goalContribution.findMany.mockResolvedValue([]);
  mock.goalContribution.aggregate.mockResolvedValue({ _sum: { value: null } });
  mock.month.findMany.mockResolvedValue([]);
  mock.month.create.mockImplementation(({ data }) => Promise.resolve({ id: 333n, ...data }));
  mock.savingsTransaction.aggregate.mockResolvedValue({ _sum: { value: null } });
  mock.savingsTransaction.findMany.mockResolvedValue([]);
  mock.auditLog.create.mockResolvedValue({});
  mock.cardInvoice.count.mockResolvedValue(0);
  mock.cardInvoice.findMany.mockResolvedValue([]);
  mock.cardInvoice.update.mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data }));
  mock.cardInvoice.updateMany.mockResolvedValue({ count: 1 });
  mock.cardInvoice.create.mockImplementation(({ data }) => Promise.resolve({ id: 888n, status: 'open', ...data }));
  mock.cardPurchase.groupBy.mockResolvedValue([]);
  mock.cardPurchase.findMany.mockResolvedValue([]);
  mock.alert.findMany.mockResolvedValue([]);
  mock.alert.update.mockResolvedValue({});
  mock.alert.upsert.mockResolvedValue({});
}

module.exports = { createPrismaMock, installDefaults };
