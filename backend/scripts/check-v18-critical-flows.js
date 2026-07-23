const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolveInvoiceForPurchase } = require('../src/utils/cardCycle');

const closingPath = path.join(__dirname, '../src/modules/closing/closing.service.js');
const closing = fs.readFileSync(closingPath, 'utf8');
const auth = fs.readFileSync(path.join(__dirname, '../src/modules/auth/auth.service.js'), 'utf8');
const logger = fs.readFileSync(path.join(__dirname, '../src/middlewares/security.js'), 'utf8');

assert.match(closing, /timeout:\s*30_000/);
assert.match(closing, /const repaired = current\.status === 'closed'/);
assert.match(closing, /generateNextMonthEntries\([\s\S]*?tx\.month\.update/);
assert.doesNotMatch(closing, /for \([^)]*incomeTemplates[^)]*\)[\s\S]{0,500}income\.findFirst/);
assert.match(auth, /REFRESH_CONCURRENCY_GRACE_MS = 10_000/);
assert.match(logger, /req\.originalUrl/);

const afterClose = resolveInvoiceForPurchase(new Date(Date.UTC(2026, 6, 19)), 18, 28);
assert.deepEqual(afterClose.reference, { month: 8, year: 2026 });
assert.equal(afterClose.dueDate.toISOString().slice(0, 10), '2026-08-28');
const onClose = resolveInvoiceForPurchase(new Date(Date.UTC(2026, 6, 18)), 18, 28);
assert.deepEqual(onClose.reference, { month: 7, year: 2026 });
assert.equal(onClose.dueDate.toISOString().slice(0, 10), '2026-07-28');

console.log('V18 crítico OK: fechamento reparável, timeout seguro, refresh concorrente, logs úteis e ciclo do cartão.');
