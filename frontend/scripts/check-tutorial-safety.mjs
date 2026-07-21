import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const { TUTORIAL_STEPS } = await import(pathToFileURL(path.join(root, 'src/lib/tutorialSteps.js')));
const runner = read('src/components/tutorial/TutorialRunner.jsx');
const sidebar = read('src/components/layout/Sidebar.jsx');
const settings = read('src/pages/SettingsPage.jsx');
const dom = read('src/lib/tutorialDom.js');

assert(TUTORIAL_STEPS.length > 0, 'O tutorial precisa ter etapas.');
assert(TUTORIAL_STEPS.every((step) => step.route === '/dashboard'), 'O tutorial não pode navegar automaticamente entre módulos.');
assert(!runner.includes('useNavigate'), 'TutorialRunner não deve controlar navegação.');
assert(!runner.includes('waitForTutorialRoute'), 'TutorialRunner não deve aguardar rotas externas.');
assert(!runner.includes('navigate('), 'TutorialRunner não deve iniciar novas páginas.');
assert(runner.includes(".driver-popover-prev-btn, .driver-popover-next-btn"), 'A espera deve bloquear somente os botões de navegação.');
assert(runner.includes('closeButton.disabled = false'), 'O botão de fechar precisa permanecer disponível.');
assert(settings.includes('requestTutorial(); navigate(\'/dashboard\')'), 'A repetição deve solicitar o tour antes de voltar ao dashboard.');

for (const selector of ['nav-incomes', 'nav-expenses', 'nav-cards', 'nav-savings', 'nav-goals', 'nav-reports', 'nav-settings']) {
  assert(sidebar.includes(`tutorial: '${selector}'`), `Faltou o marcador ${selector} na sidebar.`);
}

const timeout = Number(dom.match(/const DEFAULT_TIMEOUT = ([\d_]+);/)?.[1]?.replaceAll('_', ''));
assert(Number.isFinite(timeout) && timeout <= 5000, 'A espera padrão do tutorial deve ser curta e limitada.');

console.log(`Tutorial seguro: ${TUTORIAL_STEPS.length} etapas, uma única rota e timeout máximo de ${timeout} ms.`);
