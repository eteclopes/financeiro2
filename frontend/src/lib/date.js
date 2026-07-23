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

function normalizeLedgerMonth(month) {
  const year = Number(month?.year);
  const monthNumber = Number(month?.month);
  if (!Number.isInteger(year) || !Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) {
    return null;
  }
  return { year, month: monthNumber };
}

/**
 * Cria a data padrão dentro do mês financeiro selecionado no sistema.
 * O ano/mês nunca vêm do relógio do computador. Apenas o dia local é usado
 * como conveniência e é limitado ao último dia do mês selecionado.
 */
export function ledgerMonthDateInputValue(month, referenceDate = new Date()) {
  const normalized = normalizeLedgerMonth(month);
  if (!normalized) return localDateInputValue(referenceDate);

  const reference = localDateInputValue(referenceDate);
  const preferredDay = Number(reference.slice(8, 10)) || 1;
  const lastDay = new Date(Date.UTC(normalized.year, normalized.month, 0)).getUTCDate();
  const day = Math.min(Math.max(preferredDay, 1), lastDay);

  return `${normalized.year}-${String(normalized.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Limites canônicos para impedir datas fora do mês financeiro escolhido. */
export function ledgerMonthDateRange(month) {
  const normalized = normalizeLedgerMonth(month);
  if (!normalized) return { min: undefined, max: undefined };
  const prefix = `${normalized.year}-${String(normalized.month).padStart(2, '0')}`;
  const lastDay = new Date(Date.UTC(normalized.year, normalized.month, 0)).getUTCDate();
  return {
    min: `${prefix}-01`,
    max: `${prefix}-${String(lastDay).padStart(2, '0')}`,
  };
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
