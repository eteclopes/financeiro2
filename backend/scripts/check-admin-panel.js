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
if (failed) process.exit(1);
console.log('Painel administrativo: estrutura e proteções verificadas.');
