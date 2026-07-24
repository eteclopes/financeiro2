'use strict';

const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const prismaPath = path.join(root, 'src/config/prisma.js');
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: {} };

const { buildMonthSnapshot } = require(path.join(root, 'src/modules/months/monthSnapshot.service.js'));

const closedAt = new Date('2026-07-23T12:00:00.000Z');
const month = { id: 31n, userId: 7n, month: 7, year: 2026, status: 'closed', closedAt };
const incomes = [
  { userId: 7n, monthId: 31n, value: 2060, origin: 'digital', incomeDate: new Date('2026-07-10'), createdAt: new Date('2026-07-10T10:00:00Z') },
  // Receita do mês seguinte criada no fechamento: não pode alterar julho.
  { userId: 7n, monthId: 32n, value: 3000, origin: 'digital', incomeDate: new Date('2026-08-01'), createdAt: new Date('2026-07-23T12:00:01Z') },
];
const expenses = [
  { userId: 7n, monthId: 31n, value: 100, paidAmount: 100, status: 'paid', paymentMethod: 'balance', paidAt: new Date('2026-07-10'), deletedAt: null, createdAt: new Date('2026-07-05T10:00:00Z'), updatedAt: new Date('2026-07-10T10:00:00Z') },
  // Pagamento lançado depois do encerramento, mas com data dentro de julho.
  { userId: 7n, monthId: 32n, value: 500, paidAmount: 500, status: 'paid', paymentMethod: 'balance', paidAt: new Date('2026-07-24'), deletedAt: null, createdAt: new Date('2026-07-24T09:00:00Z'), updatedAt: new Date('2026-07-24T09:00:00Z') },
];
const savings = [
  // Depósito feito depois do fechamento com data contábil retroativa.
  { userId: 7n, type: 'deposit', origin: 'balance', value: 1770, transactionDate: new Date('2026-07-15'), createdAt: new Date('2026-07-24T10:00:00Z') },
];

function same(a, b) { return String(a) === String(b); }
function dateMatches(value, condition) {
  if (!condition) return true;
  if (condition.gte && value < condition.gte) return false;
  if (condition.lte && value > condition.lte) return false;
  return true;
}
function matches(row, where = {}) {
  for (const [key, expected] of Object.entries(where)) {
    if (key === 'goal' || key === 'debtId') continue;
    if (expected === undefined) continue;
    const value = row[key];
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      if ('not' in expected && value === expected.not) return false;
      if ('gt' in expected && !(Number(value) > Number(expected.gt))) return false;
      if ('gte' in expected || 'lte' in expected) {
        if (!dateMatches(value, expected)) return false;
        continue;
      }
      if ('in' in expected && !expected.in.some((item) => same(value, item))) return false;
      continue;
    }
    if (typeof value === 'bigint' || typeof expected === 'bigint') {
      if (!same(value, expected)) return false;
    } else if (value !== expected) return false;
  }
  return true;
}
function aggregateRows(rows, where, fields) {
  const filtered = rows.filter((row) => matches(row, where));
  const sum = {};
  for (const field of fields) sum[field] = filtered.reduce((total, row) => total + Number(row[field] ?? 0), 0) || null;
  return { _sum: sum };
}

const client = {
  income: {
    aggregate: async ({ where, _sum }) => aggregateRows(incomes, where, Object.keys(_sum)),
  },
  expense: {
    aggregate: async ({ where, _sum }) => aggregateRows(expenses, where, Object.keys(_sum)),
    findMany: async ({ where }) => expenses.filter((row) => matches(row, where)),
    groupBy: async () => [],
  },
  goalContribution: {
    aggregate: async () => ({ _sum: { value: null } }),
    findMany: async () => [],
  },
  savingsTransaction: {
    aggregate: async ({ where, _sum }) => aggregateRows(savings, where, Object.keys(_sum)),
  },
  debt: {
    aggregate: async () => ({ _sum: { remainingBalance: null } }),
    findMany: async () => [],
  },
};

(async () => {
  const snapshot = await buildMonthSnapshot(7n, month, client, {
    recordedBefore: closedAt,
    reconstructed: true,
  });

  assert.equal(snapshot.incomeTotal, 2060);
  assert.equal(snapshot.expensesPaid, 100);
  assert.equal(snapshot.currentBalance, 1960, 'lançamentos posteriores ao fechamento não podem reescrever julho');
  assert.equal(snapshot.savingsBalance, 0, 'depósito criado depois do fechamento deve ficar fora do retrato histórico');
  assert.equal(snapshot.reconstructed, true);

  const migration = fs.readFileSync(
    path.join(root, 'prisma/migrations/20260724010000_immutable_month_snapshots/migration.sql'),
    'utf8'
  );
  assert.ok(migration.includes('financial_snapshot'));
  assert.ok(migration.includes('snapshot_version'));

  const dashboard = fs.readFileSync(path.join(root, 'src/modules/dashboard/dashboard.service.js'), 'utf8');
  assert.ok(dashboard.includes('ensureClosedMonthSnapshot'));
  assert.ok(dashboard.includes('const summary = closedSnapshot ?? liveSummary'));

  const closing = fs.readFileSync(path.join(root, 'src/modules/closing/closing.service.js'), 'utf8');
  assert.ok(closing.includes('financialSnapshot: snapshot'));
  assert.ok(closing.includes('snapshotVersion: SNAPSHOT_VERSION'));

  const savingsService = fs.readFileSync(path.join(root, 'src/modules/savings/savings.service.js'), 'utf8');
  assert.ok((savingsService.match(/assertTransactionDateIsOpen/g) || []).length >= 4);

  console.log('V19 OK: meses fechados usam snapshot imutável e ignoram lançamentos criados após o encerramento.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
