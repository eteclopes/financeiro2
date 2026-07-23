import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, '../src');
const pages = ['IncomesPage.jsx','ExpensesPage.jsx','CardsPage.jsx','HistoryPage.jsx','ReportsPage.jsx','SavingsPage.jsx','TrendsPage.jsx'];

for (const page of pages) {
  const text = fs.readFileSync(path.join(src, 'pages', page), 'utf8');
  assert.match(text, /responsive-stack-table/, `${page} não usa tabela responsiva`);
  const tables = [...text.matchAll(/<table className="responsive-stack-table[\s\S]*?<\/table>/g)].map((match) => match[0]);
  assert.ok(tables.length > 0, `${page} sem tabela responsiva detectável`);
  for (const table of tables) {
    const cells = [...table.matchAll(/<td\s+([^>]*)>/g)].map((match) => match[1]);
    for (const attrs of cells) {
      if (/colSpan=/.test(attrs)) continue;
      assert.match(attrs, /data-label=/, `${page} possui célula móvel sem rótulo`);
    }
  }
}

const topbar = fs.readFileSync(path.join(src, 'components/layout/Topbar.jsx'), 'utf8');
const css = fs.readFileSync(path.join(src, 'index.css'), 'utf8');
assert.match(topbar, /notification-panel/);
assert.match(css, /@media \(max-width: 639px\)[\s\S]*?\.notification-panel\s*\{[\s\S]*?position:\s*fixed/);
assert.match(css, /\.responsive-stack-table thead\s*\{\s*display:\s*none/);

console.log('Responsividade V18 OK: notificações contidas e tabelas sem rolagem horizontal obrigatória.');
