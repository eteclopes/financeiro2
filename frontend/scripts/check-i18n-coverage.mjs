import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { translateStaticText } from '../src/i18n/translations.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '../src');
const languages = ['en', 'es', 'ru'];
const failures = [];

const criticalStatic = [
  'Receita',
  'Despesa',
  'Pagar conta',
  'Fatura',
  'Meta',
  'Fechar mês',
  'Nova Receita',
  'Nova Despesa',
  'Salvar Receita',
  'Salvar Despesa',
  'Pago',
  'Pendente',
  'Categorias',
  'Gráfico de receitas e despesas',
  'Idioma e região',
  'Detectar automaticamente',
];

const criticalDynamic = [
  'Excluir "Salário"? Esta ação não pode ser desfeita.',
  'O Plano Básico permite até 2 cartões ativos.',
  'Editar Cartão — Nubank',
  'Nova Compra — Nubank',
  'Nenhuma despesa fixa',
  'A despesa "Internet" será removida agora deste mês e não será mais gerada nos próximos. O histórico passado permanece.',
  'Nome da nova categoria de despesa...',
  '3 ativo(s)',
];

for (const phrase of [...criticalStatic, ...criticalDynamic]) {
  for (const language of languages) {
    const translated = translateStaticText(phrase, language);
    const intentionallySame = language === 'es' && ['Meta', 'Total'].includes(phrase);
    if (!translated || (translated === phrase && !intentionallySame)) {
      failures.push(`${language}: texto não traduzido: ${phrase}`);
    }
  }
}

const app = fs.readFileSync(path.join(src, 'App.jsx'), 'utf8');
const topbar = fs.readFileSync(path.join(src, 'components/layout/Topbar.jsx'), 'utf8');
const settings = fs.readFileSync(path.join(src, 'pages/SettingsPage.jsx'), 'utf8');

if (/LocaleSwitcher/.test(app) || /LocaleSwitcher/.test(topbar)) {
  failures.push('O seletor de idioma ainda aparece fora de Configurações.');
}
if (!settings.includes('role="radiogroup"') || !settings.includes('LANGUAGE_OPTIONS.map')) {
  failures.push('O seletor por cartões de idioma não foi encontrado em Configurações.');
}
if (settings.includes('<Select value={language}')) {
  failures.push('Configurações ainda usa o dropdown antigo para idioma.');
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`i18n OK: ${criticalStatic.length} textos estáticos, ${criticalDynamic.length} padrões dinâmicos e seletor restrito às Configurações.`);
