'use strict';

/**
 * Regressão V29 — ambientes Real e Simulação.
 *
 * Valida sem banco/Prisma engine:
 *  1. o cabeçalho de workspace só troca a identidade para simulações do dono;
 *  2. rotas administrativas/autenticação nunca usam o perfil simulado;
 *  3. uma ausência longa fecha todos os meses anteriores em uma única sincronização;
 *  4. o mês inicial da simulação não é substituído pela data real do PC;
 *  5. frontend envia workspace/data local e exibe os controles corretos.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const originalLoad = Module._load;

function clear(file) {
  const resolved = require.resolve(file);
  delete require.cache[resolved];
  return resolved;
}

async function checkWorkspaceIdentity() {
  const updates = [];
  const prisma = {
    simulationWorkspace: {
      findFirst: async ({ where }) => {
        if (where.id !== 9n || where.ownerUserId !== 1n) return null;
        return {
          id: 9n,
          name: 'Plano 2027',
          profileUserId: 99n,
          currentDate: new Date('2027-01-01T00:00:00.000Z'),
          owner: { plan: 'pro', planSource: 'manual_admin', planGrantedAt: null, planExpiresAt: null },
          profile: {
            id: 99n,
            plan: 'basic',
            planSource: 'basic',
            planGrantedAt: null,
            planExpiresAt: null,
            isSimulationProfile: true,
          },
        };
      },
    },
    user: { update: async (args) => { updates.push(args); return {}; } },
  };

  Module._load = function patched(request, parent, isMain) {
    if (parent?.filename?.endsWith(path.join('utils', 'workspaceContext.js')) && request === '../config/prisma') return prisma;
    return originalLoad.call(this, request, parent, isMain);
  };
  const file = path.join(root, 'backend/src/utils/workspaceContext.js');
  clear(file);
  const { resolveWorkspaceIdentity } = require(file);
  Module._load = originalLoad;

  const req = {
    originalUrl: '/api/months',
    get(name) { return name === 'x-workspace-id' ? '9' : undefined; },
  };
  await resolveWorkspaceIdentity(req, 1n);
  assert.equal(req.ownerUserId, 1n);
  assert.equal(req.userId, 99n);
  assert.equal(req.workspace.id, '9');
  assert.equal(req.workspace.type, 'simulation');
  assert.equal(req.workspace.name, 'Plano 2027');
  assert.equal(req.workspace.currentDate.toISOString().slice(0, 10), '2027-01-01');
  assert.equal(updates.length, 0, 'Resolver o ambiente não deve escrever no banco.');

  const adminReq = {
    originalUrl: '/api/admin/users',
    get() { return '9'; },
  };
  await resolveWorkspaceIdentity(adminReq, 1n);
  assert.equal(adminReq.userId, 1n, 'Admin deve continuar usando a identidade real.');
  assert.equal(adminReq.workspace.type, 'real');
}

async function checkSimulationCalendarIsolation() {
  const future = { id: 77n, userId: 99n, month: 1, year: 2027, status: 'open' };
  const prisma = {
    savingsBucket: { create: async () => ({ id: 1n }) },
    month: {
      findFirst: async ({ where, orderBy }) => {
        if (where.status === 'open' && orderBy?.[0]?.year === 'asc') return future;
        return future;
      },
      findMany: async () => [future],
      findUnique: async ({ where }) => {
        const key = where?.userId_month_year;
        return key && key.userId === 99n && key.month === 1 && key.year === 2027 ? future : null;
      },
      create: async () => { throw new Error('Não deve criar outro mês dentro da simulação.'); },
    },
  };
  Module._load = function patched(request, parent, isMain) {
    if (parent?.filename?.endsWith(path.join('months', 'months.service.js'))) {
      if (request === '../../config/prisma') return prisma;
      if (request === '../../utils/dateTime') return { getCalendarDateParts: () => ({ month: 1, year: 2027, day: 1 }) };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  const file = path.join(root, 'backend/src/modules/months/months.service.js');
  clear(file);
  const service = require(file);
  Module._load = originalLoad;

  const current = await service.getSimulationCurrentMonth(99n);
  assert.equal(current.year, 2027);
  assert.equal(current.month, 1);
  const listed = await service.listMonths(99n, { includeFuture: true });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].year, 2027);
}


async function checkWorkspaceCreationIsolation() {
  const calls = { user: [], workspace: [], month: [], audit: 0 };
  const owner = {
    id: 1n, name: 'Dono', plan: 'basic', planSource: 'basic',
    planGrantedAt: null, planExpiresAt: null,
  };
  const tx = {
    $executeRaw: async () => 1,
    user: {
      create: async ({ data }) => {
        calls.user.push(data);
        return { id: 99n, ...data };
      },
    },
    simulationWorkspace: {
      count: async () => 0,
      create: async ({ data }) => {
        calls.workspace.push(data);
        return { id: 9n, status: 'active', createdAt: new Date(), updatedAt: new Date(), ...data };
      },
    },
    savingsBucket: { create: async () => ({ id: 1n }) },
    month: {
      create: async ({ data }) => {
        calls.month.push(data);
        return { id: 77n, ...data };
      },
    },
  };
  const prisma = {
    user: { findFirst: async () => owner },
    $transaction: async (callback) => callback(tx),
  };

  Module._load = function patched(request, parent, isMain) {
    if (parent?.filename?.endsWith(path.join('workspaces', 'workspaces.service.js'))) {
      if (request === '../../config/prisma') return prisma;
      if (request === 'bcryptjs') return { hash: async () => 'hash-interno' };
      if (request === '../plans/plans.service') return { buildEntitlements: () => ({ isPro: false }) };
      if (request === '../_shared/deleteFinancialProfile') return { deleteFinancialProfile: async () => {} };
      if (request === '../closing/closing.service') return { generateNextMonthEntries: async () => { throw new Error('copySetup=false não deve gerar lançamentos.'); } };
      if (request === '../debts/debts.service') return { remainingInstallmentsFor: () => 1 };
      if (request === '../auditLog/auditLog.service') return { recordAuditLog: async () => { calls.audit += 1; } };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  const file = path.join(root, 'backend/src/modules/workspaces/workspaces.service.js');
  clear(file);
  const service = require(file);
  Module._load = originalLoad;

  const created = await service.createWorkspace(1n, {
    name: 'Ano de teste', startMonth: 1, startYear: 2027, copySetup: false,
  });
  assert.equal(created.id, '9');
  assert.equal(calls.user[0].isSimulationProfile, true);
  assert.equal(calls.user[0].role, 'user');
  assert.match(calls.user[0].email, /@internal\.financehub\.invalid$/);
  assert.equal(calls.workspace[0].ownerUserId, 1n);
  assert.equal(calls.workspace[0].profileUserId, 99n);
  assert.equal(calls.workspace[0].name, 'Ano de teste');
  assert.equal(calls.workspace[0].startMonth, 1);
  assert.equal(calls.workspace[0].startYear, 2027);
  assert.equal(calls.workspace[0].currentDate.toISOString().slice(0, 10), '2027-01-01');
  assert.equal(Number(calls.workspace[0].initialBalance), 0);
  assert.deepEqual(calls.month[0], { userId: 99n, month: 1, year: 2027, status: 'open' });
  assert.equal(calls.audit, 1);
}

async function checkSequentialAutomaticClosing() {
  const months = [
    { id: 1n, month: 1, year: 2027, status: 'open' },
  ];
  const closedOrder = [];
  let nextId = 2n;

  function chronologicalOpen() {
    return months
      .filter((item) => item.status === 'open')
      .sort((a, b) => a.year === b.year ? a.month - b.month : a.year - b.year)[0] || null;
  }

  const prisma = {
    savingsBucket: { create: async () => ({ id: 1n }) },
    month: {
      findFirst: async () => chronologicalOpen(),
    },
  };
  const monthsService = {
    getOrCreateMonth: async (_userId, month, year) => {
      let found = months.find((item) => item.month === month && item.year === year);
      if (!found) {
        found = { id: nextId++, month, year, status: 'open' };
        months.push(found);
      }
      return found;
    },
  };
  const closingService = {
    closeMonth: async (_userId, id) => {
      const current = months.find((item) => item.id === id);
      current.status = 'closed';
      closedOrder.push(`${current.month}/${current.year}`);
      let month = current.month + 1;
      let year = current.year;
      if (month === 13) { month = 1; year += 1; }
      let next = months.find((item) => item.month === month && item.year === year);
      if (!next) {
        next = { id: nextId++, month, year, status: 'open' };
        months.push(next);
      }
      return { repaired: false, nextMonth: next };
    },
  };
  let automations = 0;

  Module._load = function patched(request, parent, isMain) {
    if (parent?.filename?.endsWith(path.join('closing', 'calendarClosing.service.js'))) {
      if (request === '../../config/prisma') return prisma;
      if (request === '../../utils/dateTime') return { getCalendarDateParts: () => ({ month: 4, year: 2027, day: 1 }) };
      if (request === './closing.service') return closingService;
      if (request === '../automations/automations.service') return { runOnClose: async () => { automations += 1; return {}; } };
      if (request === '../months/months.service') return monthsService;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  const file = path.join(root, 'backend/src/modules/closing/calendarClosing.service.js');
  clear(file);
  const service = require(file);
  Module._load = originalLoad;

  const result = await service.ensureCalendarMonthsClosed(1n);
  assert.deepEqual(closedOrder, ['1/2027', '2/2027', '3/2027']);
  assert.equal(result.closed.length, 3);
  assert.equal(automations, 1, 'catch-up histórico não deve pagar automaticamente meses passados');
  assert.equal(months.find((item) => item.month === 4 && item.year === 2027).status, 'open');
}

function checkStaticIntegration() {
  const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
  const schema = read('backend/prisma/schema.prisma');
  const migration = read('backend/prisma/migrations/20260802160000_simulation_workspaces/migration.sql');
  const routes = read('backend/src/modules/months/months.routes.js');
  const appRoutes = read('backend/src/routes/index.js');
  const api = read('frontend/src/lib/api.js');
  const quick = read('frontend/src/components/dashboard/QuickActions.jsx');
  const layout = read('frontend/src/components/layout/AppLayout.jsx');
  const app = read('frontend/src/App.jsx');

  assert(schema.includes('model SimulationWorkspace'));
  assert(schema.includes('isSimulationProfile Boolean'));
  assert(migration.includes('CREATE TABLE "simulation_workspaces"'));
  assert(/router\.use\('\/workspaces',\s*workspacesRoutes\)/.test(appRoutes));
  assert(routes.includes("includeFuture: req.workspace?.type === 'simulation'"));
  assert(routes.includes("'/sync-calendar'"));
  assert(routes.includes('findCurrentMonthOrThrow'));
  assert(routes.includes('REAL_MONTH_AUTO_CLOSE'));
  assert(routes.includes("req.workspace?.type !== 'simulation'"));
  assert(api.includes("config.headers['X-Workspace-ID']"));
  assert(api.includes("config.headers['X-Client-Date']"));
  assert(quick.includes("label: monthStatus === 'open' ? 'Fechar mês' : 'Reabrir mês'"));
  assert(quick.includes("label: 'Reparar mês'"));
  assert(layout.includes('MODO SIMULAÇÃO'));
  assert(app.includes('path="/workspaces"'));
}

(async () => {
  try {
    await checkWorkspaceIdentity();
    await checkSimulationCalendarIsolation();
    await checkWorkspaceCreationIsolation();
    await checkSequentialAutomaticClosing();
    checkStaticIntegration();
    console.log('V29 OK: modo Real automático, simulações isoladas e linha do tempo manual validados.');
  } finally {
    Module._load = originalLoad;
  }
})().catch((error) => {
  Module._load = originalLoad;
  console.error(error);
  process.exitCode = 1;
});
