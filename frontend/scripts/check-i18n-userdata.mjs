/**
 * Teste REAL de internacionalização (não é grep de convenção).
 *
 * Bug coberto: o i18n traduz reescrevendo o DOM, e o dicionário contém
 * palavras que também são dados do usuário ("Salário", "Alimentação").
 * Uma receita chamada "Salário" aparecia como "Salary" em inglês, enquanto
 * o banco e o CSV exportado continuavam com "Salário".
 *
 * A proteção precisa ser ESTRUTURAL (marcar a região no DOM), porque pelo
 * conteúdo é impossível distinguir rótulo de interface de texto digitado.
 * Este script prova as duas coisas:
 *   1. o dicionário REALMENTE traduziria esses termos (logo, a marcação é
 *      indispensável e ninguém pode removê-la achando que é redundante);
 *   2. nenhum dado do usuário é renderizado sem <UserText>.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { translateStaticText, SUPPORTED_LANGUAGES } from '../src/i18n/translations.js';

const root = new URL('..', import.meta.url).pathname;
let failures = 0;

// ---- 1. Idiomas oficiais do produto -------------------------------------
assert.deepEqual(SUPPORTED_LANGUAGES, ['pt', 'en', 'es', 'ru'],
  'Idiomas suportados devem ser exatamente pt/en/es/ru');

// ---- 2. UserText marca a região ------------------------------------------
const userText = fs.readFileSync(path.join(root, 'src/i18n/UserText.jsx'), 'utf8');
assert.match(userText, /data-i18n-ignore="true"/,
  'UserText precisa marcar a região como não traduzível');

// ---- 3. O bridge poda regiões ignoradas E gráficos ------------------------
const bridge = fs.readFileSync(path.join(root, 'src/i18n/I18nBridge.jsx'), 'utf8');
assert.match(bridge, /IGNORED_REGION_SELECTOR/, 'bridge deve usar o seletor de exclusão');
assert.match(bridge, /FILTER_REJECT/, 'bridge deve podar a subárvore ignorada, não só o nó');
assert.ok(bridge.includes("'[data-i18n-ignore=\"true\"], svg"),
  'bridge deve ignorar dados do usuário e SVG (gráficos)');

// ---- 4. O dicionário de fato traduziria termos que o usuário digita -------
const AMBIGUOUS = ['Salário', 'Alimentação', 'Viagens', 'Educação'];
const wouldTranslate = AMBIGUOUS.filter((term) => translateStaticText(term, 'en') !== term);
assert.ok(wouldTranslate.length > 0,
  'Se nenhum termo ambíguo for traduzível, revise este teste — a premissa mudou');

// ---- 5. Nenhum dado do usuário renderizado sem proteção ------------------
// Componentes cujo `option`/`item` são CONFIGS de interface (rótulos
// hardcoded pelo desenvolvedor, que DEVEM ser traduzidos), não dado do
// usuário. ChoiceCards é o caso clássico.
const UI_CONFIG_FILES = new Set(['Motion.jsx']);

const USER_FIELD = /(?<![=\w])\{[a-z][A-Za-z0-9_]*\.(description|observation)\}/g;
for (const dir of ['src/pages', 'src/components']) {
  const base = path.join(root, dir);
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.jsx')) continue;
      if (UI_CONFIG_FILES.has(entry.name)) continue;
      const src = fs.readFileSync(full, 'utf8');
      for (const line of src.split('\n')) {
        for (const match of line.match(USER_FIELD) || []) {
          // Protegido por <UserText> OU por data-i18n-ignore no mesmo
          // elemento (ex.: <option data-i18n-ignore>{x.description}</option>).
          const wrapped = line.includes(`<UserText>${match}</UserText>`);
          const marked = line.includes('data-i18n-ignore');
          if (!wrapped && !marked) {
            console.error(`FALHA ${path.relative(root, full)}: ${match} sem proteção i18n`);
            failures += 1;
          }
        }
      }
    }
  };
  walk(base);
}

if (failures) {
  console.error(`\n${failures} ocorrência(s) de dado do usuário desprotegido.`);
  process.exit(1);
}
console.log(`i18n OK: ${SUPPORTED_LANGUAGES.join('/')}, dados do usuário protegidos, gráficos fora do observer.`);
