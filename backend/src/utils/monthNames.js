// Nomes dos meses em português, indexados de 1 a 12 (mesmo formato usado
// em todo o app para `month.month`) — índice 0 é um placeholder vazio de
// propósito, só para poder indexar direto por `MONTH_NAMES[month]` sem
// subtrair 1 toda vez.
const MONTH_NAMES = [
  '',
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

module.exports = { MONTH_NAMES };
