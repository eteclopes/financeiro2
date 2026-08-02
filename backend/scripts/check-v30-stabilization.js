'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const schema = read('backend/prisma/schema.prisma');
const migration = read('backend/prisma/migrations/20260802180000_stabilization_v30/migration.sql');
const auth = read('backend/src/modules/auth/auth.service.js');
const tokens = read('backend/src/utils/tokens.js');
const userController = read('backend/src/modules/auth/auth.controller.js');
const adminController = read('backend/src/modules/adminAuth/adminAuth.controller.js');
const authenticate = read('backend/src/middlewares/authenticate.js');
const dateTime = read('backend/src/utils/dateTime.js');
const incomeService = read('backend/src/modules/incomes/incomes.service.js');
const expenseService = read('backend/src/modules/expenses/expenses.service.js');
const payments = read('backend/src/modules/payments/payments.service.js');
const closing = read('backend/src/modules/closing/closing.service.js');
const dashboard = read('backend/src/modules/dashboard/dashboard.service.js');
const app = read('backend/src/app.js');
const userApi = read('frontend/src/lib/api.js');
const adminApi = read('admin-frontend/src/lib/api.js');
const userVercel = read('frontend/vercel.json');
const adminVercel = read('admin-frontend/vercel.json');
const ci = read('.github/workflows/ci.yml');
const invariants = read('backend/docs/FINANCIAL-INVARIANTS.md');
const jestConfig = read('backend/jest.config.js');

// Modelo e migration: competência e efeito no caixa são conceitos distintos.
assert.match(schema, /effectiveDate\s+DateTime/);
assert.match(schema, /reversedAmount\s+Decimal/);
assert.match(schema, /currentDate\s+DateTime/);
assert.match(schema, /initialBalance\s+Decimal/);
assert.match(schema, /timezone\s+String/);
assert.match(schema, /enum AuthClient[\s\S]*user_app[\s\S]*admin_app/);
assert.match(schema, /model CategoryBudget/);
assert.match(migration, /financehub_guard_income_month/);
assert.match(migration, /financehub_guard_expense_month/);
assert.match(migration, /financehub_atomic_audit/);
assert.match(migration, /allow_ledger_delete[\s\S]*database_trigger/);
assert.match(migration, /CATEGORY_BUDGET_OWNER_MISMATCH/);
assert.match(migration, /v_old_struct IS DISTINCT FROM v_new_struct/);
assert.match(migration, /INCOME_EFFECT_DATE_INVALID/);

// Receita continua instantânea e exclusão histórica vira estorno.
assert.match(incomeService, /effectiveDate:\s*todayUtcDate\(\)/);
assert.match(incomeService, /reversedAt:\s*todayUtcDate\(\)/);
assert.match(incomeService, /INCOME_ALREADY_REVERSED/);
assert.match(expenseService, /status:\s*'reversed'/);
assert.match(expenseService, /EXPENSE_ALREADY_REVERSED/);
assert.match(read('backend/src/modules/cards/cards.service.js'), /CARD_HAS_SETTLED_HISTORY/);
assert.doesNotMatch(expenseService, /paidAt:\s*payload\.dueDate/);
assert.match(payments, /paid_at\s*=\s*COALESCE\(paid_at/i);

// Sessões realmente separadas e refresh estrito.
assert.match(tokens, /JWT_ADMIN_AUDIENCE/);
assert.match(tokens, /payload\.client !== expectedClient/);
assert.match(userController, /__Host-financehub_refresh/);
assert.match(adminController, /__Secure-financehub_admin_refresh/);
assert.match(adminController, /path:\s*'\/api\/admin-auth'/);
assert.match(auth, /claimed\.count !== 1/);
assert.match(auth, /familyId:\s*existing\.familyId/);
assert.doesNotMatch(auth, /REFRESH_CONCURRENCY_GRACE/);
assert.match(userApi, /financehub-user-refresh/);
assert.match(adminApi, /financehub-admin-refresh/);

// Relógio e fechamento: PC validado, clock simulado e mutações protegidas.
assert.match(dateTime, /client\.date\.getTime\(\) > server\.date\.getTime\(\)/);
assert.match(authenticate, /if \(mutation\)[\s\S]*timezone/);
assert.match(authenticate, /ensureCalendarMonthsClosed/);
assert.match(authenticate, /isExplicitCalendarSync/);
assert.match(closing, /rebuildSimulationTimeline/);
assert.match(closing, /simulationWorkspace\.update[\s\S]*currentDate/);
assert.match(closing, /recalculateSavingsLedger/);

// Mês fechado não consulta indicadores vivos.
const closedStart = dashboard.indexOf('async function getClosedDashboard');
const openStart = dashboard.indexOf('async function getDashboard');
assert(closedStart >= 0 && openStart > closedStart);
const closedSource = dashboard.slice(closedStart, openStart);
assert.doesNotMatch(closedSource, /getOrComputeHealthScore|listCards|listGoals|listAlerts/);
assert.match(closedSource, /historical:\s*true/);

// Produção falha sem API e ambos os frontends têm cabeçalhos equivalentes.
assert.match(userApi, /import\.meta\.env\.PROD && !import\.meta\.env\.VITE_API_URL/);
assert.match(adminApi, /import\.meta\.env\.PROD && !import\.meta\.env\.VITE_API_URL/);
for (const config of [userVercel, adminVercel]) {
  assert.match(config, /Content-Security-Policy/);
  assert.match(config, /Strict-Transport-Security/);
  assert.match(config, /Cache-Control/);
  assert.match(config, /X-Frame-Options/);
}

// Readiness, CI real e especificação executável.
assert.match(app, /SELECT 1/);
assert.match(app, /20260802180000_stabilization_v30/);
assert.match(ci, /postgres:16/);
assert.match(ci, /prisma migrate deploy/);
assert.match(ci, /npm run build/);
assert.match(invariants, /Receita instantânea/);
assert.match(invariants, /Sessões separadas/);
assert.match(jestConfig, /coverageThreshold/);

// Não deve existir um fallback de produção versionado para a API.
assert.equal(fs.existsSync(path.join(root, 'frontend/.env.production')), false);

console.log('V30 OK: tempo, histórico, estornos, sessões, banco, CI e deploy estabilizados.');
