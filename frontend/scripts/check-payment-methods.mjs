import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BALANCE_PAYMENT_OPTIONS,
  RECEIPT_OPTIONS,
  getExpensePaymentOptions,
  getPaymentMethodLabel,
  normalizePaymentMethod,
} from '../src/lib/paymentMethods.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.resolve(here, '..');
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

assert(RECEIPT_OPTIONS.map((item) => item.value).join(',') === 'debit,cash', 'Receitas devem oferecer apenas saldo da conta e dinheiro físico.');
assert(BALANCE_PAYMENT_OPTIONS.map((item) => item.value).join(',') === 'debit,cash', 'Pagamentos sem cartão devem oferecer apenas saldo da conta e dinheiro físico.');
assert(getExpensePaymentOptions([]).map((item) => item.value).join(',') === 'debit,cash', 'Crédito não pode aparecer sem cartão ativo.');
assert(getExpensePaymentOptions([{ id: 1, active: true }]).map((item) => item.value).join(',') === 'debit,credit,cash', 'Crédito deve aparecer quando existe cartão ativo.');
assert(getExpensePaymentOptions([{ id: 1, active: false }]).map((item) => item.value).join(',') === 'debit,cash', 'Cartão inativo não pode liberar crédito.');

for (const legacy of ['pix', 'debit', 'transfer']) {
  assert(normalizePaymentMethod(legacy) === 'debit', `O método legado ${legacy} precisa ser tratado como saldo da conta.`);
  assert(getPaymentMethodLabel(legacy) === 'Saldo da conta', `O método legado ${legacy} não pode reaparecer como opção separada.`);
}

const files = [
  'src/pages/IncomesPage.jsx',
  'src/pages/ExpensesPage.jsx',
  'src/pages/CardsPage.jsx',
  'src/components/dashboard/QuickActions.jsx',
].map((relative) => [relative, fs.readFileSync(path.join(frontend, relative), 'utf8')]);

for (const [relative, source] of files) {
  for (const obsolete of ["label:'PIX'", "label: 'PIX'", "label:'Débito'", "label: 'Débito'", "label:'Transferência'", "label: 'Transferência'"]) {
    assert(!source.includes(obsolete), `${relative} voltou a declarar a opção redundante ${obsolete}.`);
  }
}

const incomes = files.find(([relative]) => relative.endsWith('IncomesPage.jsx'))?.[1] ?? '';
assert(!incomes.includes('Origem do dinheiro'), 'O formulário de receita voltou a exibir o seletor duplicado de origem.');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('Métodos financeiros OK: saldo da conta, crédito condicionado a cartão ativo e dinheiro físico.');
