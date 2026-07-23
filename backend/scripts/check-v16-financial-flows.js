'use strict';

const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const prismaPath = path.join(root, 'src/config/prisma.js');
const auditPath = path.join(root, 'src/modules/auditLog/auditLog.service.js');
const monthsPath = path.join(root, 'src/modules/months/months.service.js');
const projectionsPath = path.join(root, 'src/modules/projections/projections.service.js');

let nextBucketId = 1n;
let nextTransactionId = 1n;
let clock = 0;
const buckets = [];
const transactions = [];

const sameId = (a, b) => String(a) === String(b);
const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

function latest(list) {
  return [...list].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
    return Number(b.id - a.id);
  })[0] ?? null;
}

function matchesWhere(row, where = {}) {
  return Object.entries(where).every(([key, expected]) => {
    if (expected === undefined) return true;
    if (key === 'transactionDate' && expected && typeof expected === 'object') {
      const value = new Date(row.transactionDate).getTime();
      if (expected.gte && value < new Date(expected.gte).getTime()) return false;
      if (expected.lte && value > new Date(expected.lte).getTime()) return false;
      return true;
    }
    if (typeof expected === 'bigint' || typeof row[key] === 'bigint') return sameId(row[key], expected);
    return row[key] === expected;
  });
}

const prisma = {
  user: {},
  income: {
    aggregate: async () => ({ _sum: { value: 1000 } }),
  },
  expense: {
    aggregate: async () => ({ _sum: { paidAmount: 0 } }),
  },
  goalContribution: {
    aggregate: async () => ({ _sum: { value: 0 } }),
  },
  savingsBucket: {
    findFirst: async ({ where }) => buckets.find((row) => matchesWhere(row, where)) ?? null,
    create: async ({ data }) => {
      const row = {
        id: nextBucketId++,
        userId: data.userId,
        kind: data.kind ?? 'general',
        name: data.name ?? null,
        targetValue: data.targetValue ?? null,
        isDefault: data.isDefault ?? false,
        isArchived: data.isArchived ?? false,
        createdAt: ++clock,
        updatedAt: clock,
      };
      buckets.push(row);
      return { ...row };
    },
    update: async ({ where, data }) => {
      const row = buckets.find((item) => sameId(item.id, where.id));
      if (!row) throw new Error('bucket not found');
      Object.assign(row, data, { updatedAt: ++clock });
      return { ...row };
    },
    findMany: async ({ where }) => buckets.filter((row) => matchesWhere(row, where)).map((row) => {
      const last = latest(transactions.filter((tx) => sameId(tx.bucketId, row.id)));
      return { ...row, transactions: last ? [{ bucketBalanceAfter: last.bucketBalanceAfter }] : [] };
    }),
  },
  savingsTransaction: {
    findFirst: async ({ where }) => latest(transactions.filter((row) => matchesWhere(row, where))),
    findMany: async ({ where = {} }) => transactions.filter((row) => matchesWhere(row, where)).sort((a, b) => Number(b.id - a.id)),
    create: async ({ data, include }) => {
      const row = {
        id: nextTransactionId++,
        ...data,
        createdAt: ++clock,
      };
      transactions.push(row);
      return include?.bucket
        ? { ...row, bucket: { ...buckets.find((bucket) => sameId(bucket.id, row.bucketId)) } }
        : { ...row };
    },
    update: async ({ where, data, include }) => {
      const row = transactions.find((item) => sameId(item.id, where.id));
      Object.assign(row, data);
      return include?.bucket
        ? { ...row, bucket: { ...buckets.find((bucket) => sameId(bucket.id, row.bucketId)) } }
        : { ...row };
    },
    delete: async ({ where }) => {
      const index = transactions.findIndex((item) => sameId(item.id, where.id));
      return transactions.splice(index, 1)[0];
    },
    aggregate: async ({ where = {} }) => {
      const value = transactions
        .filter((row) => matchesWhere(row, where))
        .reduce((sum, row) => sum + Number(row.value), 0);
      return { _sum: { value: round2(value) } };
    },
  },
  $executeRaw: async (strings, ...values) => {
    const sql = Array.isArray(strings) ? strings.join('?') : String(strings);
    if (sql.includes('INSERT INTO "savings_buckets"')) {
      const userId = values[0];
      if (!buckets.some((bucket) => sameId(bucket.userId, userId) && bucket.isDefault)) {
        buckets.push({
          id: nextBucketId++,
          userId,
          kind: 'general',
          name: null,
          targetValue: null,
          isDefault: true,
          isArchived: false,
          createdAt: ++clock,
          updatedAt: clock,
        });
      }
    }
    return undefined;
  },
  $transaction: async (callback) => callback(prisma),
};

require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: prisma };
require.cache[auditPath] = {
  id: auditPath,
  filename: auditPath,
  loaded: true,
  exports: { recordAuditLog: async () => undefined },
};
require.cache[monthsPath] = {
  id: monthsPath,
  filename: monthsPath,
  loaded: true,
  exports: { getMonthOrThrow: async () => ({ id: 1n, month: 1, year: 2030 }) },
};
require.cache[projectionsPath] = {
  id: projectionsPath,
  filename: projectionsPath,
  loaded: true,
  exports: {
    getProjectionComponents: async () => ({
      months: Array.from({ length: 12 }, (_, index) => ({ month: index + 1, year: 2030 })),
      recurringIncome: 1000,
      fixedExpenses: 0,
      debtSchedule: Array(12).fill(0),
      cardSchedule: Array(12).fill(0),
    }),
    mergeComponentsIntoSeries: (components) => {
      let cumulativeNet = 0;
      return components.months.map((period, index) => {
        const netProjected = round2(
          Number(components.recurringIncome)
          - Number(components.fixedExpenses)
          - Number(components.debtSchedule[index] ?? 0)
          - Number(components.cardSchedule[index] ?? 0)
        );
        cumulativeNet = round2(cumulativeNet + netProjected);
        return { ...period, netProjected, cumulativeNet };
      });
    },
    getSingleDebtSchedule: async () => Array(12).fill(0),
  },
};

const savings = require(path.join(root, 'src/modules/savings/savings.service.js'));
const { getAvailableBalance } = require(path.join(root, 'src/modules/_shared/balance.js'));
const calculators = require(path.join(root, 'src/modules/calculators/calculators.service.js'));
const whatIf = require(path.join(root, 'src/modules/simulators/whatIfSimulator.service.js'));

(async () => {
  const migration = fs.readFileSync(
    path.join(root, 'prisma/migrations/20260723130000_savings_buckets/migration.sql'),
    'utf8'
  );
  for (const requiredSql of [
    'CREATE TABLE "savings_buckets"',
    'UPDATE "savings_transactions" AS st',
    'CREATE TRIGGER "savings_transactions_fill_bucket_fields"',
    'ON CONFLICT DO NOTHING',
    'ALTER COLUMN "bucket_id" SET NOT NULL',
  ]) {
    assert.ok(migration.includes(requiredSql), `migration incompleta: ${requiredSql}`);
  }
  assert.ok(
    migration.indexOf('CREATE TRIGGER "savings_transactions_fill_bucket_fields"')
      < migration.indexOf('ALTER COLUMN "bucket_id" SET NOT NULL'),
    'o trigger de compatibilidade precisa existir antes do NOT NULL'
  );

  const userId = 7n;
  const general = await savings.ensureDefaultBucket(userId);
  const emergency = await savings.createBucket(userId, { kind: 'emergency', name: null, targetValue: 6000 });
  const travel = await savings.createBucket(userId, { kind: 'travel', name: null, targetValue: 2000 });

  // A data é apenas referência: mesmo um mês futuro deve ser aceito e o efeito
  // financeiro acontece no momento em que a operação é salva.
  const futureReferenceDate = new Date('2030-12-15T00:00:00.000Z');
  await savings.deposit(userId, { bucketId: emergency.id, value: 200, date: futureReferenceDate, origin: 'balance' });
  assert.equal(await getAvailableBalance(userId), 800);
  assert.equal(await savings.getCurrentBalance(userId), 200);
  assert.equal(await savings.getBucketBalance(userId, emergency.id), 200);

  await savings.transfer(userId, {
    fromBucketId: emergency.id,
    toBucketId: travel.id,
    value: 50,
    date: futureReferenceDate,
  });
  assert.equal(await getAvailableBalance(userId), 800, 'transferência interna não pode alterar saldo livre');
  assert.equal(await savings.getCurrentBalance(userId), 200, 'transferência interna não pode alterar total reservado');
  assert.equal(await savings.getBucketBalance(userId, emergency.id), 150);
  assert.equal(await savings.getBucketBalance(userId, travel.id), 50);

  await savings.withdraw(userId, { bucketId: travel.id, value: 20, date: futureReferenceDate });
  assert.equal(await getAvailableBalance(userId), 820, 'retirada deve devolver valor ao saldo livre');
  assert.equal(await savings.getCurrentBalance(userId), 180);
  assert.equal(await savings.getBucketBalance(userId, travel.id), 30);

  await savings.deposit(userId, { bucketId: general.id, value: 100, date: futureReferenceDate, origin: 'external' });
  assert.equal(await getAvailableBalance(userId), 820, 'valor externo não deve reduzir saldo livre');
  assert.equal(await savings.getCurrentBalance(userId), 280);
  assert.equal(await savings.getNetMovementInRange(userId, new Date('2029-01-01'), new Date('2031-01-01')), 180);
  assert.deepEqual(await savings.getBalanceBreakdown(userId), {
    totalReserved: 280,
    movedFromBalance: 180,
    externalReported: 100,
  });

  await savings.transfer(userId, {
    fromBucketId: travel.id,
    toBucketId: emergency.id,
    value: 30,
    date: futureReferenceDate,
  });
  assert.equal(await getAvailableBalance(userId), 820);
  assert.equal(await savings.getCurrentBalance(userId), 280);
  assert.equal(await savings.getBucketBalance(userId, travel.id), 0);
  const archived = await savings.archiveBucket(userId, travel.id);
  assert.equal(archived.isArchived, true);
  const restored = await savings.restoreBucket(userId, travel.id);
  assert.equal(restored.isArchived, false);

  const monthly = calculators.calculateFinancing({
    assetValue: 10000,
    downPayment: 0,
    rate: 1,
    ratePeriod: 'monthly',
    months: 12,
    system: 'price',
    extraFees: 0,
  });
  const annual = calculators.calculateFinancing({
    assetValue: 10000,
    downPayment: 0,
    rate: 12.682503,
    ratePeriod: 'annual',
    months: 12,
    system: 'price',
    extraFees: 0,
  });
  assert.ok(Math.abs(monthly.firstInstallment - annual.firstInstallment) < 0.1);

  const preview = await whatIf.runScenarioPreview(userId, 1n, 'save_monthly', { amount: 100 }, 12);
  assert.equal(preview.totalReserved, 1200);
  assert.equal(preview.availableBalanceImpact, -1200);
  assert.equal(preview.totalWealthImpact, 0, 'guardar não reduz patrimônio total');
  assert.equal(preview.comparison.at(-1).scenarioTotalCumulative, preview.comparison.at(-1).baselineCumulative);

  console.log('Fluxos V16 OK: financiamento mensal/anual, projeção de reserva, saldo livre, caixinhas, retirada, valor externo e transferência interna.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
