const assert = require('node:assert/strict');
const { parseConfiguredOrigins, createOriginPolicy } = require('../src/utils/corsOrigins');

const productionOrigins = parseConfiguredOrigins(
  'https://financeiro2-six.vercel.app,https://admin-frontend-kzu7.vercel.app'
);
const policy = createOriginPolicy({
  configuredOrigins: productionOrigins,
  allowPreviews: false,
});

assert.equal(policy.isAllowed('https://financeiro2-six.vercel.app'), true);
assert.equal(policy.isAllowed('https://admin-frontend-kzu7.vercel.app'), true);
assert.equal(
  policy.isAllowed('https://admin-frontend-kzu7-apvehkpax-eteclopes-projects.vercel.app'),
  false
);

console.log('CORS de produção OK: sistema e painel fixo permitidos; preview bloqueado.');
