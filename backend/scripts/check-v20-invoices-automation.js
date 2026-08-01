'use strict';

/**
 * Regressão v20 — faturas no pagamento individual e automação.
 *
 * Não depende de Jest nem de banco. Executa os serviços com dependências
 * controladas para garantir as regras que quebraram no sistema:
 *  1. <optgroup> não pode apagar o valor da fatura no Dropdown;
 *  2. despesa fixa no crédito preserva o dia real da cobrança;
 *  3. a prévia do próximo mês inclui fatura aberta que vence no mês e
 *     cobranças fixas ainda não materializadas;
 *  4. a automação envia a fatura encontrada ao pagamento em lote.
 */
const assert = require('assert');
const fs = require('fs');
const Module = require('module');
const path = require('path');

const projectRoot = path.resolve(__dirname, '../..');
const originalLoad = Module._load;

function clearModuleServices() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}backend${path.sep}src${path.sep}modules${path.sep}`)) {
      delete require.cache[key];
    }
  }
}

async function checkFixedChargeDay() {
  const calls = {};
  const prisma = {
    category: { findFirst: async () => ({ id: 3n }) },
    fixedExpenseTemplate: {
      create: async ({ data }) => {
        calls.template = data;
        return { id: 77n, ...data };
      },
    },
    expense: { create: async () => { throw new Error('Não deveria criar despesa comum.'); } },
    $transaction: async (callback) => callback(prisma),
  };
  const month = { id: 60n, month: 8, year: 2026, status: 'open' };
  const card = { id: 5n, userId: 10n, active: true, closingDay: 10, dueDay: 17 };
  const cardPurchases = {
    createFixedCardCharge: async (args) => {
      calls.charge = args;
      return { expense: { id: 99n } };
    },
  };

  Module._load = function loadMock(request, parent, isMain) {
    const from = parent?.filename || '';
    if (request === '../../config/prisma' && from.endsWith('expenses.service.js')) return prisma;
    if (request === '../months/months.service' && from.endsWith('expenses.service.js')) {
      return { getMonthOrThrow: async () => month, assertMonthIsOpen: () => {} };
    }
    if (request === '../_shared/balance' && from.endsWith('expenses.service.js')) {
      return { assertSufficientBalance: async () => {}, lockUserBalance: async () => {} };
    }
    if (request === '../cards/cards.service' && from.endsWith('expenses.service.js')) {
      return { getOwnedCardOrThrow: async () => card };
    }
    if (request === '../cards/cardPurchases.service' && from.endsWith('expenses.service.js')) return cardPurchases;
    return originalLoad(request, parent, isMain);
  };

  const servicePath = path.join(projectRoot, 'backend/src/modules/expenses/expenses.service.js');
  delete require.cache[require.resolve(servicePath)];
  const service = require(servicePath);
  await service.createFixedExpense(10n, {
    monthId: 60n,
    description: 'Streaming',
    categoryId: 3n,
    value: 50,
    dueDay: 5,
    paymentMethod: 'credit',
    cardId: 5n,
  });

  assert.strictEqual(calls.template.dueDay, 5, 'O template deve preservar o dia real da cobrança.');
  assert.strictEqual(
    calls.charge.dueDate.toISOString().slice(0, 10),
    '2026-08-05',
    'A cobrança deve ser lançada no dia escolhido, não no vencimento do cartão.'
  );
}

async function checkNextMonthPreviewAndPayment() {
  const paymentCalls = [];
  const prisma = {
    automationSetting: {
      findUnique: async () => ({
        payDuesOnClose: true,
        payDuesMethod: 'debit',
        payDebts: true,
        payBills: true,
        payInvoices: true,
        payOpenInvoices: false,
        minimumBalance: 0,
        saveLeftoverOnClose: false,
        saveLeftoverType: 'percent',
        saveLeftoverValue: 0,
        saveLeftoverBucketId: null,
      }),
    },
    cardInvoice: {
      findMany: async () => ([{
        id: 900n,
        status: 'open',
        dueDate: new Date(Date.UTC(2026, 7, 17)),
        expenses: [{ value: 90, paidAmount: 0 }],
      }]),
    },
    fixedExpenseTemplate: {
      findMany: async () => ([{
        id: 77n,
        userId: 10n,
        active: true,
        paymentMethod: 'credit',
        value: 55,
        dueDay: 5,
        card: { id: 5n, closingDay: 10, dueDay: 17 },
      }]),
    },
    expense: { findMany: async () => [] },
    savingsBucket: { findFirst: async () => null },
  };
  const payments = {
    getPayableItems: async () => ({
      bills: [],
      debts: [],
      invoices: [{ id: '900', amount: 145, stillOpen: true }],
      totalSelectable: 145,
    }),
    payBillsBatch: async (_userId, payload) => {
      paymentCalls.push(payload);
      return { paidInvoicesCount: 1, total: 145 };
    },
  };

  Module._load = function loadMock(request, parent, isMain) {
    const from = parent?.filename || '';
    if (request === '../../config/prisma' && from.endsWith('automations.service.js')) return prisma;
    if (request === '../payments/payments.service' && from.endsWith('automations.service.js')) return payments;
    if (request === '../savings/savings.service' && from.endsWith('automations.service.js')) {
      return { deposit: async () => ({}) };
    }
    if (request === '../months/months.service' && from.endsWith('automations.service.js')) {
      return { getMonthOrThrow: async () => ({ id: 60n, month: 7, year: 2026, status: 'open' }) };
    }
    if (request === '../projections/projections.service' && from.endsWith('automations.service.js')) {
      return {
        getProjectionComponents: async () => ({
          months: [{ month: 7, year: 2026 }, { month: 8, year: 2026 }],
          recurringIncome: 0,
          fixedExpenses: 0,
          debtSchedule: [0, 0],
          cardSchedule: [0, 0],
        }),
      };
    }
    if (request === '../_shared/balance' && from.endsWith('automations.service.js')) {
      return { getAvailableBalance: async () => 1000 };
    }
    return originalLoad(request, parent, isMain);
  };

  const servicePath = path.join(projectRoot, 'backend/src/modules/automations/automations.service.js');
  delete require.cache[require.resolve(servicePath)];
  const service = require(servicePath);

  const preview = await service.previewAutomations(10n, 60n, 'next');
  assert.strictEqual(preview.totalToPay, 145, 'A prévia deve somar R$ 90 reais + R$ 55 projetados.');
  const invoiceGroup = preview.groups.find((group) => group.key === 'invoices');
  assert.strictEqual(invoiceGroup.total, 145);
  assert.strictEqual(invoiceGroup.projectedCount, 1);
  assert(preview.warnings.some((warning) => warning.code === 'FATURA_PROJETADA'));

  const execution = await service.runAutoPayments(10n, 61n, {
    payDuesMethod: 'debit',
    payDebts: true,
    payBills: true,
    payInvoices: true,
    payOpenInvoices: false,
    minimumBalance: 0,
  });
  assert.strictEqual(execution.paidInvoices, 1, 'A automação deve registrar a fatura como paga.');
  assert.deepStrictEqual(paymentCalls[0].invoiceIds, ['900'], 'A fatura deve ser enviada ao lote automático.');
}

function checkDropdownOptgroups() {
  const source = fs.readFileSync(
    path.join(projectRoot, 'frontend/src/components/ui/Dropdown.jsx'),
    'utf8'
  );
  assert(source.includes("child.type === 'optgroup'"), 'Dropdown precisa reconhecer <optgroup>.');
  assert(/flattenOptions\(\s*child\.props\.children/.test(source), 'Dropdown precisa percorrer opções do grupo.');
  assert(source.includes('data-option-index={index}'), 'Navegação deve apontar para a opção real.');
}

(async () => {
  try {
    await checkFixedChargeDay();
    clearModuleServices();
    await checkNextMonthPreviewAndPayment();
    checkDropdownOptgroups();
    console.log('OK: seleção individual, ciclo da cobrança e automação da fatura do próximo mês validados.');
  } finally {
    Module._load = originalLoad;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
