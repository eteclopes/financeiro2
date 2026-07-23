import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(process.cwd(), 'src');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const failures = [];

const dateFiles = [
  'pages/IncomesPage.jsx',
  'pages/ExpensesPage.jsx',
  'pages/CardsPage.jsx',
  'pages/GoalsPage.jsx',
  'components/dashboard/QuickActions.jsx',
];

for (const file of dateFiles) {
  const source = read(file);
  if (!source.includes('ledgerMonthDateInputValue')) failures.push(`${file}: data padrão não usa o mês financeiro`);
  if (!source.includes('ledgerMonthDateRange')) failures.push(`${file}: input não limita a data ao mês financeiro`);
}

const toast = read('components/ui/Toast.jsx');
if (!toast.includes('createPortal')) failures.push('Toast.jsx: notificações não estão portadas para document.body');
if (!toast.includes('toast-layer')) failures.push('Toast.jsx: camada global de notificações ausente');

const quickActions = read('components/dashboard/QuickActions.jsx');
if (quickActions.includes('localDateInputValue')) failures.push('QuickActions.jsx: ainda usa a data do computador diretamente');

if (failures.length) {
  console.error('Falhas de segurança dos formulários:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Formulários usam o mês financeiro e notificações aparecem acima dos modais.');
