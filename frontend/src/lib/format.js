const MONTH_NAMES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

export function formatCurrency(value) {
  const number = Number(value ?? 0);
  return number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatMonthLabel(month) {
  if (!month) return '';
  const name = MONTH_NAMES[month.month - 1] ?? '';
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${month.year}`;
}

export function formatShortDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
}
