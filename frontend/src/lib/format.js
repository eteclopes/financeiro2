import { getLocalePreferences } from '../store/localeStore.js';


function isCalendarDate(value) {
  return /^\d{4}-\d{2}-\d{2}(?:T00:00:00(?:\.000)?Z)?$/.test(String(value || ''));
}

function safeNumber(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

export function formatCurrency(value, options = {}) {
  const { locale, currency } = getLocalePreferences();
  const number = safeNumber(value);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      ...options,
    }).format(number);
  } catch {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(number);
  }
}

export function formatNumber(value, options = {}) {
  const { locale } = getLocalePreferences();
  try {
    return new Intl.NumberFormat(locale, options).format(safeNumber(value));
  } catch {
    return String(safeNumber(value));
  }
}

export function formatPercent(value, options = {}) {
  return formatNumber(value, {
    style: 'percent',
    maximumFractionDigits: 1,
    ...options,
  });
}

export function formatMonthLabel(month) {
  if (!month) return '';
  const { locale } = getLocalePreferences();
  const date = new Date(Date.UTC(Number(month.year), Number(month.month) - 1, 1));
  try {
    const result = new Intl.DateTimeFormat(locale, {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date);
    return result.charAt(0).toLocaleUpperCase(locale) + result.slice(1);
  } catch {
    return `${String(month.month).padStart(2, '0')}/${month.year}`;
  }
}

export function formatShortDate(dateString, options = {}) {
  if (!dateString) return '';
  const { locale, timeZone } = getLocalePreferences();
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: '2-digit',
      timeZone: isCalendarDate(dateString) ? 'UTC' : timeZone,
      ...options,
    }).format(date);
  } catch {
    return date.toISOString().slice(5, 10).split('-').reverse().join('/');
  }
}

export function formatLongDate(dateString, options = {}) {
  if (!dateString) return '';
  const { locale, timeZone } = getLocalePreferences();
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeZone: isCalendarDate(dateString) ? 'UTC' : timeZone,
      ...options,
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}
