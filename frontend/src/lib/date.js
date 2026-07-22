import { getLocalePreferences } from '../store/localeStore.js';

/**
 * Retorna YYYY-MM-DD no fuso selecionado pelo usuário. Esse formato é o único
 * enviado pelos inputs date à API; a ordem visual fica a cargo do navegador,
 * respeitando o atributo lang aplicado pelo componente Input.
 */
export function localDateInputValue(date = new Date()) {
  const { timeZone } = getLocalePreferences();
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

/** Converte um campo DATE da API para o valor canônico de input date. */
export function apiDateToInput(value) {
  if (!value) return '';
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
