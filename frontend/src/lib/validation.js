// Validações reutilizáveis de formulário — mesmo espírito de
// backend/src/utils/cpf.js: nenhum formulário reimplementa esses cálculos
// na mão. Vale lembrar: isto é só para dar feedback rápido ao usuário
// (evitar um round-trip ao servidor por um erro óbvio) — a validação que
// realmente decide se algo é salvo é sempre a do backend (Zod), nunca esta.

export function isValidCPF(rawValue) {
  if (typeof rawValue !== 'string') return false;
  const cpf = rawValue.replace(/\D/g, '');
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const digits = cpf.split('').map(Number);
  const calcCheckDigit = (baseDigits, firstWeight) => {
    const sum = baseDigits.reduce((acc, digit, i) => acc + digit * (firstWeight - i), 0);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  if (calcCheckDigit(digits.slice(0, 9), 10) !== digits[9]) return false;
  if (calcCheckDigit(digits.slice(0, 10), 11) !== digits[10]) return false;
  return true;
}

export function formatCPF(rawValue) {
  const cpf = (rawValue ?? '').replace(/\D/g, '').padEnd(11, ' ').slice(0, 11);
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9, 11)}`.trim();
}

export function isValidEmail(value) {
  // Checagem simples e permissiva de propósito (não tenta cobrir toda a
  // RFC 5322) — o objetivo é pegar erros óbvios de digitação; o backend
  // (Zod .email()) é quem de fato valida antes de gravar qualquer coisa.
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function isPositiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

export function isPositiveInteger(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0;
}
