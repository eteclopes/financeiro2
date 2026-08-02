const { randomUUID } = require('node:crypto');
const prisma = require('../../src/config/prisma');

const dbDescribe = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

dbDescribe('PostgreSQL integrity and V30 migration', () => {
  let userId;
  let categoryId;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        name: 'CI integration',
        email: `ci-${randomUUID()}@example.test`,
        passwordHash: '$2a$12$RXUW.qmEXBzInhTZlg2mM.VsSzXz7.mx2Ym7fdqSQc5iXHat1EaKC',
      },
    });
    userId = user.id;
    const category = await prisma.category.create({
      data: { userId, name: 'CI income', type: 'income', isDefault: false },
    });
    categoryId = category.id;
  });

  afterAll(async () => {
    if (userId) {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SELECT set_config('financehub.allow_ledger_delete', 'on', true)");
        await tx.user.delete({ where: { id: userId } });
      });
    }
    await prisma.$disconnect();
  });

  test('latest stabilization migration is applied', async () => {
    const rows = await prisma.$queryRaw`
      SELECT migration_name
      FROM "_prisma_migrations"
      WHERE migration_name = '20260802180000_stabilization_v30'
        AND finished_at IS NOT NULL
        AND rolled_back_at IS NULL
    `;
    expect(rows).toHaveLength(1);
  });

  test('income keeps competence date and immediate cash-effect date separately', async () => {
    const month = await prisma.month.create({
      data: { userId, month: 12, year: 2099, status: 'open' },
    });
    const financialDateRows = await prisma.$queryRaw`
      SELECT financehub_financial_date_for_user(${userId}) AS financial_date
    `;
    const income = await prisma.income.create({
      data: {
        userId,
        monthId: month.id,
        description: 'Future competence',
        value: 100,
        categoryId,
        paymentMethod: 'pix',
        origin: 'digital',
        incomeDate: new Date('2099-12-20T00:00:00.000Z'),
        effectiveDate: financialDateRows[0].financial_date,
      },
    });
    expect(income.incomeDate.toISOString()).not.toBe(income.effectiveDate.toISOString());
  });


  test('real income cannot be backdated into historical cash', async () => {
    const month = await prisma.month.findUnique({ where: { userId_month_year: { userId, month: 12, year: 2099 } } });
    await expect(prisma.income.create({
      data: {
        userId,
        monthId: month.id,
        description: 'Forbidden backdated cash',
        value: 5,
        categoryId,
        paymentMethod: 'pix',
        origin: 'digital',
        incomeDate: new Date('2099-12-21T00:00:00.000Z'),
        effectiveDate: new Date('2020-01-01T00:00:00.000Z'),
      },
    })).rejects.toThrow(/INCOME_EFFECT_DATE_INVALID|INCOME_CASH_EFFECT_IMMUTABLE|current financial date/i);
  });

  test('database guard blocks structural rewrite of a closed month', async () => {
    const month = await prisma.month.create({
      data: { userId, month: 11, year: 2099, status: 'closed', closedAt: new Date() },
    });
    await expect(prisma.income.create({
      data: {
        userId,
        monthId: month.id,
        description: 'Forbidden rewrite',
        value: 10,
        categoryId,
        paymentMethod: 'pix',
        origin: 'digital',
        incomeDate: new Date('2099-11-01T00:00:00.000Z'),
        effectiveDate: new Date('2099-01-01T00:00:00.000Z'),
      },
    })).rejects.toThrow(/MONTH_IMMUTABLE|closed or elapsed/i);
  });


  test('historical cash income cannot be physically deleted, but can be reversed', async () => {
    const month = await prisma.month.findUnique({ where: { userId_month_year: { userId, month: 12, year: 2099 } } });
    const income = await prisma.income.findFirst({ where: { userId, monthId: month.id, description: 'Future competence' } });
    await expect(prisma.income.delete({ where: { id: income.id } }))
      .rejects.toThrow(/INCOME_REVERSAL_REQUIRED|must be reversed/i);
    const reversed = await prisma.income.update({
      where: { id: income.id },
      data: { reversedAt: new Date(), reversedAmount: 100 },
    });
    expect(Number(reversed.reversedAmount)).toBe(100);
  });

  test('atomic database audit records core ledger mutations', async () => {
    const row = await prisma.auditLog.findFirst({
      where: { userId, entity: 'incomes', action: { endsWith: '_atomic' } },
      orderBy: { createdAt: 'desc' },
    });
    expect(row).not.toBeNull();
  });

  test('refresh sessions are separated by client type', async () => {
    const family = randomUUID();
    await prisma.refreshToken.createMany({
      data: [
        { userId, tokenHash: randomUUID().replaceAll('-', ''), familyId: family, client: 'user_app', expiresAt: new Date('2099-01-01') },
        { userId, tokenHash: randomUUID().replaceAll('-', ''), familyId: family, client: 'admin_app', expiresAt: new Date('2099-01-01') },
      ],
    });
    const grouped = await prisma.refreshToken.groupBy({
      by: ['client'], where: { userId, familyId: family }, _count: { _all: true },
    });
    expect(grouped.map((row) => row.client).sort()).toEqual(['admin_app', 'user_app']);
  });
});
