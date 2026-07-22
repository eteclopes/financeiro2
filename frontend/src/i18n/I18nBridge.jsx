import { useEffect } from 'react';
import { useLocaleStore } from '../store/localeStore.js';
import { translateAttribute, translateStaticText } from './translations.js';

const TEXT_ORIGINAL = new WeakMap();
const TEXT_LAST_APPLIED = new WeakMap();
const ATTR_ORIGINAL = new WeakMap();
const ATTR_LAST_APPLIED = new WeakMap();
const TRANSLATABLE_ATTRIBUTES = ['placeholder', 'title', 'aria-label', 'aria-description'];

function shouldSkipNode(node) {
  const parent = node?.parentElement;
  if (!parent) return true;
  if (parent.closest('[data-i18n-ignore="true"], script, style, textarea, [contenteditable="true"]')) return true;
  return false;
}

function applyTextNode(node, language) {
  if (!node || node.nodeType !== Node.TEXT_NODE || shouldSkipNode(node)) return;
  const current = node.nodeValue ?? '';
  const last = TEXT_LAST_APPLIED.get(node);

  // Se o React atualizou o nó, essa nova versão em português vira a origem.
  if (!TEXT_ORIGINAL.has(node) || current !== last) TEXT_ORIGINAL.set(node, current);
  const original = TEXT_ORIGINAL.get(node) ?? current;
  const next = translateStaticText(original, language);
  TEXT_LAST_APPLIED.set(node, next);
  if (current !== next) node.nodeValue = next;
}

function getAttributeMap(store, element) {
  let map = store.get(element);
  if (!map) { map = new Map(); store.set(element, map); }
  return map;
}

function applyAttributes(element, language) {
  if (!(element instanceof Element) || element.closest('[data-i18n-ignore="true"]')) return;
  const originals = getAttributeMap(ATTR_ORIGINAL, element);
  const applied = getAttributeMap(ATTR_LAST_APPLIED, element);

  for (const name of TRANSLATABLE_ATTRIBUTES) {
    if (!element.hasAttribute(name)) continue;
    const current = element.getAttribute(name) ?? '';
    const last = applied.get(name);
    if (!originals.has(name) || current !== last) originals.set(name, current);
    const original = originals.get(name) ?? current;
    const next = translateAttribute(original, language);
    applied.set(name, next);
    if (current !== next) element.setAttribute(name, next);
  }
}

function walk(root, language) {
  if (!root) return;
  if (root.nodeType === Node.TEXT_NODE) {
    applyTextNode(root, language);
    return;
  }
  if (!(root instanceof Element) && root !== document.body) return;
  if (root instanceof Element) applyAttributes(root, language);

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) applyTextNode(node, language);
    else applyAttributes(node, language);
    node = walker.nextNode();
  }
}

/**
 * Camada de compatibilidade para internacionalizar o frontend existente sem
 * duplicar páginas nem alterar dados do usuário. Só textos estáticos extraídos
 * do próprio código são traduzidos; descrições, nomes e categorias digitadas
 * pelo usuário permanecem intactos.
 */
export function I18nBridge() {
  const language = useLocaleStore((state) => state.language);
  const locale = useLocaleStore((state) => state.locale);
  const initialize = useLocaleStore((state) => state.initialize);

  useEffect(() => { initialize(); }, [initialize]);

  useEffect(() => {
    document.documentElement.lang = language || 'pt';
    document.documentElement.dir = 'ltr';
    walk(document.body, language);

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'characterData') {
          applyTextNode(record.target, language);
        } else if (record.type === 'attributes') {
          applyAttributes(record.target, language);
        } else {
          record.addedNodes.forEach((node) => walk(node, language));
        }
      }
    });

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: TRANSLATABLE_ATTRIBUTES,
    });

    return () => observer.disconnect();
  }, [language, locale]);

  return null;
}
