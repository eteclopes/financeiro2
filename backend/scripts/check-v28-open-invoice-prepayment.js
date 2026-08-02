'use strict';

/**
 * Regressão V28 — pagamento antecipado não encerra a fatura.
 *
 * Sem Jest, Prisma engine ou banco. Executa os serviços com dependências
 * controladas e valida:
 *  1. pagar antes do fechamento mantém status `open`;
 *  2. pagar depois do fechamento resulta em `paid`;
 *  3. cobrança nova reutiliza o mesmo ciclo mesmo se a versão antiga o
 *     marcou como `paid`;
 *  4. cobrança nova reabre a fatura e não é empurrada para o mês seguinte;
 *  5. o frontend usa o saldo pendente, não o total histórico, ao pagar.
 */
const assert = require('assert');
const fs = require('fs');
const Module = require('module');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const originalLoad = Module._load;

function clearServiceCache() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}backend${path.sep}src${path.sep}modules${path.sep}`)) {
      delete require.cache[key];
    }
  }
}

async function runPayInvoice(closingDate) {
  const updates = [];
  const prisma = {
    $transaction: async (callback) => callback(prisma),
    $queryRaw: async () => [{ id: 3n, status: 'paid', closing_date: closingDate }],
    $executeRaw: async () => 1,
    expense: {
      findMany: async () => [{ id: 21n, value: 100, paidAmount: 0 }],
      updateMany: async () => ({ count: 1 }),
      aggregate: async () => ({ _sum: { paidAmount: 0 } }),
    },
    income: { aggregate: async () => ({ _sum: { value: 1000 } }) },
    cardInvoice: {
      update: async ({ where, data }) => {
        updates.push({ where, data });
        return { id: where.id, ...data };
      },
    },
  };

  Module._load = function loadMock(request, parent, isMain) {
    const from = parent?.filename || '';
    if (request === '@prisma/client') {
      return { Prisma: { sql: (strings, ...values) => ({ strings, values }) } };
    }
    if (request === '../../config/prisma' && from.endsWith('cardInvoices.service.js')) return prisma;
    if (request === '../_shared/balance' && from.endsWith('cardInvoices.service.js')) {
      return { lockUserBalance: async () => {}, assertSufficientBalance: async () => {} };
    }
    return originalLoad(request, parent, isMain);
  };

  const servicePath = path.join(root, 'backend/src/modules/cards/cardInvoices.service.js');
  delete require.cache[require.resolve(servicePath)];
  const service = require(servicePath);
  await service.payInvoice(10n, 3n, 'debit');
  return updates.at(-1).data;
}

async function checkPaymentLifecycle() {
  const early = await runPayInvoice(new Date('2099-12-10'));
  assert.strictEqual(early.status, 'open', 'Pagamento antecipado deve manter a fatura aberta.');

  clearServiceCache();
  const afterClose = await runPayInvoice(new Date('2000-01-10'));
  assert.strictEqual(afterClose.status, 'paid', 'Após o fechamento, a quitação deve marcar a fatura como paga.');
}

async function checkChargeStaysInSameCycle() {
  const updates = [];
  const existing = {
    id: 900n,
    cardId: 5n,
    monthId: 60n,
    referenceMonth: 9,
    referenceYear: 2099,
    closingDate: new Date('2099-09-10'),
    dueDate: new Date('2099-09-17'),
    status: 'paid',
  };
  const prisma = {
    cardInvoice: {
      findUnique: async () => existing,
      update: async ({ where, data }) => {
        updates.push({ where, data });
        return { ...existing, ...data };
      },
    },
  };

  Module._load = function loadMock(request, parent, isMain) {
    const from = parent?.filename || '';
    if (request === '@prisma/client') {
      return { Prisma: { sql: (strings, ...values) => ({ strings, values }) } };
    }
    if (request === '../../config/prisma' && from.endsWith('cardPurchases.service.js')) return prisma;
    if (request === '../months/months.service' && from.endsWith('cardPurchases.service.js')) return {};
    if (request === '../expenses/expenses.service' && from.endsWith('cardPurchases.service.js')) return {};
    if (request === './cards.service' && from.endsWith('cardPurchases.service.js')) return {};
    if (request === '../auditLog/auditLog.service' && from.endsWith('cardPurchases.service.js')) {
      return { recordAuditLog: async () => {} };
    }
    return originalLoad(request, parent, isMain);
  };

  const servicePath = path.join(root, 'backend/src/modules/cards/cardPurchases.service.js');
  delete require.cache[require.resolve(servicePath)];
  const service = require(servicePath);
  const card = { id: 5n, userId: 10n, closingDay: 10, dueDay: 17 };

  const found = await service.getOrCreateInvoice(card, 9, 2099, prisma);
  assert.strictEqual(found.id, 900n, 'A cobrança deve reutilizar a mesma fatura de referência.');

  await service.registerChargeOnInvoice(found, card, 50, prisma);
  assert.strictEqual(updates.at(-1).data.status, 'open', 'Cobrança nova deve reabrir o ciclo futuro.');
  assert.strictEqual(updates.at(-1).data.paidAt, null, 'Fatura com nova pendência não pode continuar com quitação final.');
}

async function checkLegacyFixedChargeRepair() {
  const moves = [];
  const invoiceUpdates = [];
  const targetInvoice = {
    id: 901n, cardId: 5n, monthId: 61n, referenceMonth: 9, referenceYear: 2099,
    closingDate: new Date('2099-09-10'), dueDate: new Date('2099-09-17'), status: 'paid',
    paidAt: new Date('2099-08-20'),
  };
  const prisma = {
    $transaction: async (callback) => callback(prisma),
    $executeRaw: async () => 1,
    expense: {
      findMany: async () => [{
        id: 77n, dueDate: new Date('2099-09-05'), createdAt: new Date('2099-08-21'), status: 'pending', fixedTemplateId: 44n,
        cardInvoice: {
          id: 902n, referenceMonth: 10, referenceYear: 2099,
          card: { id: 5n, userId: 10n, closingDay: 10, dueDay: 17 },
        },
      }],
      update: async ({ where, data }) => { moves.push({ where, data }); return { id: where.id, ...data }; },
      aggregate: async ({ where }) => ({ _sum: { value: where.cardInvoiceId === 901n ? 50 : 0 } }),
    },
    cardInvoice: {
      findUnique: async ({ where }) => {
        const ref = where.cardId_referenceMonth_referenceYear;
        return ref.referenceMonth === 9 && ref.referenceYear === 2099 ? targetInvoice : null;
      },
      update: async ({ where, data }) => { invoiceUpdates.push({ where, data }); return { id: where.id, ...data }; },
    },
  };

  Module._load = function loadMock(request, parent, isMain) {
    const from = parent?.filename || '';
    if (request === '@prisma/client') {
      return { Prisma: { sql: (strings, ...values) => ({ strings, values }) } };
    }
    if (request === '../../config/prisma' && from.endsWith('cardPurchases.service.js')) return prisma;
    if (request === '../months/months.service' && from.endsWith('cardPurchases.service.js')) return {};
    if (request === '../expenses/expenses.service' && from.endsWith('cardPurchases.service.js')) return {};
    if (request === './cards.service' && from.endsWith('cardPurchases.service.js')) return {};
    if (request === '../auditLog/auditLog.service' && from.endsWith('cardPurchases.service.js')) {
      return { recordAuditLog: async () => {} };
    }
    return originalLoad(request, parent, isMain);
  };

  const servicePath = path.join(root, 'backend/src/modules/cards/cardPurchases.service.js');
  delete require.cache[require.resolve(servicePath)];
  const service = require(servicePath);
  const result = await service.repairPendingFixedChargeAssignments(10n, 5n);
  assert.strictEqual(result.moved, 1, 'A cobrança fixa deslocada deve ser reparada.');
  assert.deepStrictEqual(moves[0].data, { cardInvoiceId: 901n });
  assert(invoiceUpdates.some((item) => item.where.id === 901n), 'O total da fatura correta deve ser recalculado.');
  assert(invoiceUpdates.some((item) => item.where.id === 902n), 'O total da fatura antiga deve ser recalculado.');
}

async function checkRepairIsConservative() {
  const prisma = {
    $transaction: async (callback) => callback(prisma),
    $executeRaw: async () => 1,
    expense: {
      findMany: async () => [{
        id: 88n, dueDate: new Date('2099-09-05'), createdAt: new Date('2099-08-21'),
        status: 'pending', fixedTemplateId: 45n,
        cardInvoice: {
          id: 903n, referenceMonth: 10, referenceYear: 2099,
          card: { id: 6n, userId: 10n, closingDay: 10, dueDay: 17 },
        },
      }],
      update: async () => { throw new Error('Não deveria mover sem evidência de pagamento antecipado.'); },
      aggregate: async () => ({ _sum: { value: 0 } }),
    },
    cardInvoice: {
      findUnique: async () => ({
        id: 904n, referenceMonth: 9, referenceYear: 2099, paidAt: null, status: 'open',
      }),
      update: async () => ({}),
    },
  };
  Module._load = function loadMock(request, parent, isMain) {
    const from = parent?.filename || '';
    if (request === '@prisma/client') {
      return { Prisma: { sql: (strings, ...values) => ({ strings, values }) } };
    }
    if (request === '../../config/prisma' && from.endsWith('cardPurchases.service.js')) return prisma;
    if (request === '../months/months.service' && from.endsWith('cardPurchases.service.js')) return {};
    if (request === '../expenses/expenses.service' && from.endsWith('cardPurchases.service.js')) return {};
    if (request === './cards.service' && from.endsWith('cardPurchases.service.js')) return {};
    if (request === '../auditLog/auditLog.service' && from.endsWith('cardPurchases.service.js')) return { recordAuditLog: async () => {} };
    return originalLoad(request, parent, isMain);
  };
  const servicePath = path.join(root, 'backend/src/modules/cards/cardPurchases.service.js');
  delete require.cache[require.resolve(servicePath)];
  const service = require(servicePath);
  const result = await service.repairPendingFixedChargeAssignments(10n, 6n);
  assert.strictEqual(result.moved, 0, 'Sem evidência de antecipação, a cobrança não deve ser movida.');
}

function checkFrontendOutstandingAmount() {
  const cards = fs.readFileSync(path.join(root, 'frontend/src/pages/CardsPage.jsx'), 'utf8');
  const quick = fs.readFileSync(path.join(root, 'frontend/src/components/dashboard/QuickActions.jsx'), 'utf8');
  assert(cards.includes('payTarget.outstandingValue ?? payTarget.totalValue'));
  assert(quick.includes('invoiceTarget.outstandingValue ?? invoiceTarget.totalValue'));
  assert(quick.includes('Number(invoice.outstandingValue ?? invoice.totalValue ?? 0) > 0.009'));
}

(async () => {
  try {
    await checkPaymentLifecycle();
    clearServiceCache();
    await checkChargeStaysInSameCycle();
    clearServiceCache();
    await checkLegacyFixedChargeRepair();
    clearServiceCache();
    await checkRepairIsConservative();
    checkFrontendOutstandingAmount();
    console.log('OK: pagamento antecipado mantém a fatura aberta e novas cobranças permanecem no ciclo correto.');
  } finally {
    Module._load = originalLoad;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
