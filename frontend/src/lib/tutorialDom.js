const DEFAULT_TIMEOUT = 4_500;
const POLL_INTERVAL = 80;
const VIEWPORT_MARGIN = 24;

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function selectorsList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

function abortError() {
  return new DOMException('Tutorial cancelado', 'AbortError');
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

export function isTutorialElementVisible(element) {
  if (!(element instanceof Element)) return false;
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== 'none'
    && style.visibility !== 'hidden'
    && Number(style.opacity || 1) > 0.02
    && rect.width > 2
    && rect.height > 2
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
    if (!document.fonts?.ready) return;
    await Promise.race([
      document.fonts.ready,
      new Promise((resolve) => window.setTimeout(resolve, 1_200)),
    ]);
  } catch {
    // A fonte nunca deve impedir o uso do sistema nem do tutorial.
  }
}

async function waitForAnimationFrames(count = 2, signal) {
  for (let i = 0; i < count; i += 1) {
    throwIfAborted(signal);
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
  }
}

function routeStage() {
  return document.querySelector('.route-stage');
}

function routeIsBusy() {
  const stage = routeStage();
  if (!stage) return true;
  return Boolean(stage.querySelector(
    '.shimmer-bg, [data-loading="true"], [data-page-loading="true"], [aria-busy="true"], .animate-pulse:not(.tutorial-allowed-pulse)'
  ));
}

async function waitUntil(check, { timeout = DEFAULT_TIMEOUT, signal } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    throwIfAborted(signal);
    const result = check();
    if (result) return result;
    await sleep(POLL_INTERVAL);
  }
  return null;
}

async function waitForFiniteAnimations(root, { signal, timeout = 1_500 } = {}) {
  if (!root?.getAnimations) {
    await waitForAnimationFrames(4, signal);
    return;
  }

  const startedAt = Date.now();
  let quietFrames = 0;

  while (Date.now() - startedAt < timeout) {
    throwIfAborted(signal);
    const running = root.getAnimations({ subtree: true }).filter((animation) => {
      if (animation.playState !== 'running' && animation.playState !== 'pending') return false;
      const timing = animation.effect?.getTiming?.();
      // Aurora, brilho e outros movimentos contínuos não bloqueiam o tour.
      return timing?.iterations !== Infinity;
    });

    quietFrames = running.length === 0 ? quietFrames + 1 : 0;
    if (quietFrames >= 3) return;
    await waitForAnimationFrames(1, signal);
  }
}

async function waitForStableBox(element, { signal, timeout = 1_600, frames = 3 } = {}) {
  if (!element) return false;
  let previous = null;
  let stableFrames = 0;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeout) {
    throwIfAborted(signal);
    await waitForAnimationFrames(1, signal);
    if (!isTutorialElementVisible(element)) return false;

    const rect = element.getBoundingClientRect();
    const current = [rect.x, rect.y, rect.width, rect.height, window.scrollX, window.scrollY]
      .map((value) => Math.round(value * 10) / 10);
    const same = previous && current.every((value, index) => Math.abs(value - previous[index]) < 0.7);
    stableFrames = same ? stableFrames + 1 : 0;
    previous = current;
    if (stableFrames >= frames) return true;
  }
  return false;
}

function visibleViewportRatio(element) {
  const rect = element.getBoundingClientRect();
  const left = Math.max(rect.left, VIEWPORT_MARGIN);
  const right = Math.min(rect.right, window.innerWidth - VIEWPORT_MARGIN);
  const top = Math.max(rect.top, VIEWPORT_MARGIN);
  const bottom = Math.min(rect.bottom, window.innerHeight - VIEWPORT_MARGIN);
  const visibleWidth = Math.max(0, right - left);
  const visibleHeight = Math.max(0, bottom - top);
  const visibleArea = visibleWidth * visibleHeight;
  const totalArea = Math.max(1, rect.width * rect.height);
  return visibleArea / totalArea;
}

function elementHasUsableViewportPosition(element) {
  if (!isTutorialElementVisible(element)) return false;
  const rect = element.getBoundingClientRect();
  const elementLargerThanViewport = rect.height > window.innerHeight - VIEWPORT_MARGIN * 2
    || rect.width > window.innerWidth - VIEWPORT_MARGIN * 2;
  return visibleViewportRatio(element) >= (elementLargerThanViewport ? 0.55 : 0.92);
}

async function placeElementInViewport(element, { signal } = {}) {
  if (!element) return false;
  element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });

  const inViewport = await waitUntil(
    () => elementHasUsableViewportPosition(element) && element,
    { signal, timeout: 1_800 }
  );
  if (!inViewport) return false;

  return waitForStableBox(element, { signal, timeout: 1_600, frames: 3 });
}

export async function waitForTutorialRoute(pathname, { signal, timeout = DEFAULT_TIMEOUT } = {}) {
  return waitUntil(
    () => window.location.pathname === pathname,
    { signal, timeout }
  );
}

/**
 * Aguarda um marcador explícito da página. Isso evita considerar a tela pronta
 * apenas porque o cabeçalho ou um botão já apareceu antes dos dados principais.
 */
export async function waitForTutorialPage(pageReadySelector, { signal, timeout = DEFAULT_TIMEOUT } = {}) {
  await waitForFonts();
  await waitAnimationReady(signal);

  const ready = await waitUntil(() => {
    if (document.visibilityState === 'hidden' || routeIsBusy()) return null;
    const marker = pageReadySelector
      ? findVisibleTutorialElement(pageReadySelector)
      : routeStage();
    return marker || null;
  }, { signal, timeout });

  if (!ready) return null;
  await waitForFiniteAnimations(routeStage(), { signal });
  const stable = await waitForStableBox(ready, { signal, frames: 3 });
  return stable ? ready : null;
}

/**
 * Prepara cada etapa somente depois de rota, dados, animações e posição no
 * viewport estarem estáveis. O popover nunca deve aparecer sobre skeletons ou
 * apontar para um componente ainda fora da tela.
 */
export async function prepareTutorialStep(step, { signal, timeout = DEFAULT_TIMEOUT } = {}) {
  const pageMarker = await waitForTutorialPage(
    step.pageReady || step.readyElement || step.element,
    { signal, timeout }
  );

  if (!pageMarker) return { status: 'timeout', element: null };

  const readySelectors = step.readyElement || step.element || step.pageReady;
  const readiness = await waitUntil(() => {
    if (routeIsBusy()) return null;
    if (!readySelectors) return routeStage();
    return findVisibleTutorialElement(readySelectors);
  }, { signal, timeout: Math.min(timeout, 3_000) });

  if (!readiness) return { status: 'timeout', element: null };

  if (!step.element) {
    await waitForFiniteAnimations(routeStage(), { signal });
    await waitForStableBox(readiness, { signal, frames: 3 });
    return { status: 'ready', element: null };
  }

  let target = findVisibleTutorialElement(step.element);

  if (!target && step.skipIfHidden && hasTutorialSelector(step.element)) {
    return { status: 'hidden', element: null };
  }

  if (!target) {
    target = await waitUntil(
      () => !routeIsBusy() && findVisibleTutorialElement(step.element),
      { signal, timeout: Math.min(timeout, 3_000) }
    );
  }

  if (!target) return { status: 'missing', element: null };

  await waitForFiniteAnimations(routeStage(), { signal });
  const positioned = await placeElementInViewport(target, { signal });
  if (!positioned) return { status: 'not-visible', element: null };

  await waitForAnimationFrames(3, signal);
  if (!elementHasUsableViewportPosition(target)) return { status: 'not-visible', element: null };

  return { status: 'ready', element: target };
}

async function waitAnimationReady(signal) {
  if (document.readyState === 'loading') {
    await new Promise((resolve, reject) => {
      const onAbort = () => reject(abortError());
      const onReady = () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      document.addEventListener('DOMContentLoaded', onReady, { once: true });
    });
  }
  await waitForAnimationFrames(4, signal);
}
