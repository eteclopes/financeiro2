#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const modulesDir = path.join(root, 'src', 'modules');
const failures = [];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

for (const file of walk(modulesDir).filter((name) => name.endsWith('.routes.js'))) {
  const relative = path.relative(root, file);
  const source = fs.readFileSync(file, 'utf8');
  if (relative.endsWith(path.join('auth', 'auth.routes.js'))) continue;
  if (!source.includes("require('../../middlewares/authenticate')") || !/router\.use\(authenticate/.test(source)) {
    failures.push(`${relative}: módulo privado sem router.use(authenticate)`);
  }
}

for (const file of walk(path.join(root, 'src')).filter((name) => name.endsWith('.js'))) {
  const relative = path.relative(root, file);
  const source = fs.readFileSync(file, 'utf8');
  const forbidden = [
    /req\.body\.(?:userId|user_id|isPro|plan)\b/,
    /req\.query\.(?:userId|user_id)\b/,
    /req\.params\.(?:userId|user_id)\b/,
    /console\.log\([^\n]*(?:password|token|secret|DATABASE_URL)/i,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(source)) failures.push(`${relative}: padrão inseguro detectado (${pattern})`);
  }
}

const appSource = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
if (!appSource.includes('privateApiHeaders') || !appSource.includes('enforceTrustedOrigin')) {
  failures.push('src/app.js: cabeçalhos privados ou validação de Origin ausentes');
}

const auditSource = fs.readFileSync(path.join(root, 'src', 'modules', 'auditLog', 'auditLog.service.js'), 'utf8');
if (
  !auditSource.includes('buildAuditSnapshot') ||
  /oldValueJson:\s*oldValue\b/.test(auditSource) ||
  /newValueJson:\s*newValue\b/.test(auditSource)
) {
  failures.push('auditLog.service.js: snapshots financeiros podem estar sendo gravados sem sanitização');
}

const seedSource = fs.readFileSync(path.join(root, 'prisma', 'seed-pro-test.js'), 'utf8');
if (
  /console\.log\([^\n]*\$\{password\}/.test(seedSource) ||
  /console\.log\([^\n]*\$\{user\.email\}/.test(seedSource)
) {
  failures.push('seed-pro-test.js: credencial ou e-mail completo pode aparecer no log');
}

if (failures.length) {
  console.error('Falhas nos limites de segurança:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Limites de segurança verificados: autenticação, isolamento, logs privados e auditoria sanitizada.');
