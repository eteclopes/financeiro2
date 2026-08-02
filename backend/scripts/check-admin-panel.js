const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const checks = [
  ['schema role', 'backend/prisma/schema.prisma', /enum UserRole[\s\S]*admin[\s\S]*role\s+UserRole/],
  ['migration', 'backend/prisma/migrations/20260801200000_admin_panel/migration.sql', /ADD COLUMN "role"/],
  ['admin middleware', 'backend/src/middlewares/requireAdmin.js', /user\.role !== 'admin'/],
  ['admin routes', 'backend/src/modules/admin/admin.routes.js', /router\.use\(authenticate, requireAdmin\)/],
  ['admin overview', 'backend/src/modules/admin/admin.service.js', /async function overview/],
  ['admin users', 'backend/src/modules/admin/admin.service.js', /async function listUsers/],
  ['admin delete user', 'backend/src/modules/admin/admin.service.js', /async function deleteUser/],
  ['admin delete route', 'backend/src/modules/admin/admin.routes.js', /router\.delete\('\/users\/:id'/],
  ['admin delete without legacy subscriptions SQL', 'backend/src/modules/admin/admin.service.js', /async function deleteUser[\s\S]*prisma\.user\.delete/],
  ['admin grant Pro', 'admin-frontend/src/pages/UserDetailPage.jsx', /Conceder Plano Pro/],
  ['admin delete UI', 'admin-frontend/src/pages/UserDetailPage.jsx', /Excluir usuário/],
  ['admin delete confirmation without typing email', 'admin-frontend/src/pages/UserDetailPage.jsx', /window\.confirm\([\s\S]*não poderá ser desfeita/],
  ['admin frontend app', 'admin-frontend/src/App.jsx', /AdminLayout/],
  ['admin route registration', 'backend/src/routes/index.js', /router\.use\('\/admin'/],
];

let failed = 0;
for (const [label, relative, pattern] of checks) {
  const file = path.join(root, relative);
  const content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const ok = pattern.test(content);
  console.log(`${ok ? 'OK' : 'FAIL'} ${label}`);
  if (!ok) failed += 1;
}

const adminService = fs.readFileSync(path.join(root, 'backend/src/modules/admin/admin.service.js'), 'utf8');
const hasLegacySubscriptionsSql = adminService.includes('DELETE FROM "subscriptions"')
  || (adminService.includes('$executeRaw') && adminService.includes('subscriptions'));
if (hasLegacySubscriptionsSql) {
  console.log('FAIL admin delete contains legacy subscriptions SQL');
  failed += 1;
} else {
  console.log('OK admin delete has no legacy subscriptions SQL');
}
if (failed) process.exit(1);
console.log('Painel administrativo: estrutura e proteções verificadas.');
