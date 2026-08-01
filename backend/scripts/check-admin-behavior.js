const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const users = [
  { id: 1n, name: 'Admin', email: 'admin@example.com', role: 'admin', plan: 'pro', planSource: 'manual_admin', planExpiresAt: null, createdAt: new Date() },
  { id: 2n, name: 'Pessoa', email: 'user@example.com', role: 'user', plan: 'basic', planSource: 'basic', planExpiresAt: null, createdAt: new Date() },
];
let auditCalls = 0;
let lastUserUpdate = null;

const prisma = {
  user: {
    count: async ({ where } = {}) => {
      if (where?.role === 'admin') return users.filter((u) => u.role === 'admin').length;
      if (where?.plan === 'pro') return users.filter((u) => u.plan === 'pro').length;
      if (where?.createdAt) return users.length;
      return users.length;
    },
    findMany: async ({ take, select } = {}) => users.slice(0, take || users.length).map((u) => ({ ...u })),
    findUnique: async ({ where }) => users.find((u) => u.id === where.id) || null,
    update: async ({ where, data, select }) => {
      const user = users.find((u) => u.id === where.id);
      if (!user) throw new Error('missing user');
      Object.assign(user, data);
      lastUserUpdate = data;
      return { ...user };
    },
  },
  billingPurchase: {
    aggregate: async () => ({ _sum: { amountTotal: 1990 } }),
    count: async ({ where } = {}) => where?.status === 'pending' ? 1 : 2,
    findMany: async () => [],
  },
  month: { count: async () => 3 },
  auditLog: { count: async () => 0, findMany: async () => [] },
  refreshToken: { updateMany: async () => ({ count: 2 }) },
  $queryRaw: async () => [{ '?column?': 1 }],
};

const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (parent?.filename?.endsWith(path.join('modules', 'admin', 'admin.service.js'))) {
    if (request === '../../config/prisma') return prisma;
    if (request === '../../config/env') return { NODE_ENV: 'test' };
    if (request === '../auditLog/auditLog.service') return { recordAuditLog: async () => { auditCalls += 1; } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const service = require('../src/modules/admin/admin.service');
Module._load = originalLoad;

(async () => {
  const overview = await service.overview();
  assert.equal(overview.metrics.totalUsers, 2);
  assert.equal(overview.metrics.proUsers, 1);
  assert.equal(overview.metrics.revenueCents, 1990);
  assert.equal(overview.signups.length, 30);

  await assert.rejects(
    () => service.updateUserRole(1n, 1n, 'user'),
    (error) => error.code === 'SELF_DEMOTION_BLOCKED'
  );

  const promoted = await service.updateUserRole(1n, 2n, 'admin');
  assert.equal(promoted.role, 'admin');

  await service.updateUserPlan(1n, 2n, 'pro');
  assert.equal(lastUserUpdate.planSource, 'manual_admin');
  assert.equal(lastUserUpdate.plan, 'pro');

  users[1].planSource = 'stripe_lifetime';
  await assert.rejects(
    () => service.updateUserPlan(1n, 2n, 'basic'),
    (error) => error.code === 'PAID_PLAN_REVOCATION_BLOCKED'
  );
  users[1].planSource = 'manual_admin';

  const sessions = await service.revokeUserSessions(1n, 2n);
  assert.equal(sessions.revokedSessions, 2);
  assert.ok(auditCalls >= 3);

  console.log('Comportamento administrativo OK: métricas, papéis, plano e revogação de sessões.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
