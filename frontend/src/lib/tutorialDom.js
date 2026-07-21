const DEFAULT_TIMEOUT = 12_000;
const POLL_INTERVAL = 70;

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function selectorsList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

export function isTutorialElementVisible(element) {
  if (!(element instanceof Element)) return false;
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== 'none'
    && style.visibility !== 'hidden'
    && Number(style.opacity || 1) > 0
    && rect.width > 1
    && rect.height > 1
    && element.getClientRects().length > 0;
}

export function findVisibleTutorialElement(selectors) {
  for (const selector of selectorsList(selectors)) {
    const candidates = document.querySelectorAll(selector);
    for (const candidate of candidates) {
      if (isTutorialElementVisible(candidate)) return candidate;
    }
  }
  return null;
}

export function hasTutorialSelector(selectors) {
  return selectorsList(selectors).some((selector) => document.querySelector(selector));
}

async function waitForFonts() {
  try {
    await document.fonts?.ready;
  } catch {
    // Fontes não devem impedir o tutorial de funcionar.
  }
}

async function waitForAnimationFrames(count = 2) {
  for (let i = 0; i < count; i += 1) {
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
  }
}

function routeIsBusy() {
  const stage = document.querySelector('.route-stage');
  if (!stage) return true;
  return Boolean(stage.querySelector(
    '.shimmer-bg, [data-loading="true"], [aria-busy="true"], .animate-pulse:not(.tutorial-allowed-pulse)'
  ));
}

async function waitUntil(check, { timeout = DEFAULT_TIMEOUT, signal } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    if (signal?.aborted) throw new DOMException('Tutorial cancelado', 'AbortError');
    const result = check();
    if (result) return result;
    await sleep(POLL_INTERVAL);
  }
  return null;
}

async function waitForStableBox(element, { signal, timeout = 2_000 } = {}) {
  if (!element) return;
  let previous = null;
  let stableFrames = 0;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeout) {
    if (signal?.aborted) throw new DOMException('Tutorial cancelado', 'AbortError');
    await waitForAnimationFrames(1);
    const rect = element.getBoundingClientRect();
    const current = [rect.x, rect.y, rect.width, rect.height].map((value) => Math.round(value * 10) / 10);
    const same = previous && current.every((value, index) => Math.abs(value - previous[index]) < 0.8);
    stableFrames = same ? stableFrames + 1 : 0;
    previous = current;
    if (stableFrames >= 3) return;
  }
}

export async function waitForTutorialRoute(pathname, { signal, timeout = DEFAULT_TIMEOUT } = {}) {
  return waitUntil(
    () => window.location.pathname === pathname,
    { signal, timeout }
  );
}

/**
 * Espera a página estar realmente utilizável. Em vez de depender de um
 * setTimeout fixo, aguarda: rota correta, fontes, fim dos skeletons, elemento
 * de prontidão, alvo visível e caixa estável por alguns frames.
 */
export async function prepareTutorialStep(step, { signal, timeout = DEFAULT_TIMEOUT } = {}) {
  await waitForFonts();
  await waitAnimationReady(signal);

  const readySelectors = step.readyElement || step.element;
  const readiness = await waitUntil(() => {
    if (routeIsBusy()) return null;
    if (!readySelectors) return document.querySelector('.route-stage');
    return findVisibleTutorialElement(readySelectors);
  }, { signal, timeout });

  if (!readiness) return { status: 'timeout', element: null };

  if (!step.element) {
    await waitForStableBox(readiness, { signal });
    return { status: 'ready', element: null };
  }

  let target = findVisibleTutorialElement(step.element);

  // Em telas menores alguns controles de desktop existem no DOM, porém ficam
  // ocultos por CSS. Esses passos são pulados imediatamente, sem deixar o
  // usuário esperando o timeout inteiro.
  if (!target && step.skipIfHidden && hasTutorialSelector(step.element)) {
    return { status: 'hidden', element: null };
  }

  if (!target) {
    target = await waitUntil(
      () => !routeIsBusy() && findVisibleTutorialElement(step.element),
      { signal, timeout: Math.min(timeout, 7_000) }
    );
  }

  if (!target) return { status: 'missing', element: null };

  target.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
  await waitForStableBox(target, { signal });
  await waitForAnimationFrames(2);
  return { status: 'ready', element: target };
}

async function waitAnimationReady(signal) {
  if (document.readyState === 'loading') {
    await new Promise((resolve, reject) => {
      const onAbort = () => reject(new DOMException('Tutorial cancelado', 'AbortError'));
      const onReady = () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      document.addEventListener('DOMContentLoaded', onReady, { once: true });
    });
  }
  await waitForAnimationFrames(3);
}
