/**
 * Validação de CPF (dígitos verificadores), algoritmo padrão da Receita
 * Federal. Não existe hoje nenhum campo de CPF no sistema — este
 * utilitário fica pronto para uso assim que um formulário precisar dele
 * (ex.: perfil do usuário), em vez de cada lugar reimplementar o cálculo.
 *
 * Uso com Zod:
 *   cpf: z.string().refine(isValidCPF, 'CPF inválido.')
 */
function isValidCPF(rawValue) {
  if (typeof rawValue !== 'string') return false;
  const cpf = rawValue.replace(/\D/g, '');

  if (cpf.length !== 11) return false;
  // Sequências como '111.111.111-11' passam no cálculo dos dígitos mas
  // não são CPFs válidos de verdade — a Receita já trata isso como inválido.
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const digits = cpf.split('').map(Number);

  const firstCheckDigit = calcCheckDigit(digits.slice(0, 9), 10);
  if (firstCheckDigit !== digits[9]) return false;

  const secondCheckDigit = calcCheckDigit(digits.slice(0, 10), 11);
  if (secondCheckDigit !== digits[10]) return false;

  return true;
}

function calcCheckDigit(baseDigits, firstWeight) {
  const sum = baseDigits.reduce((acc, digit, i) => acc + digit * (firstWeight - i), 0);
  const remainder = (sum * 10) % 11;
  return remainder === 10 ? 0 : remainder;
}

/** Formata só para exibição: '12345678900' -> '123.456.789-00'. */
function formatCPF(rawValue) {
  const cpf = (rawValue ?? '').replace(/\D/g, '').padEnd(11, ' ').slice(0, 11);
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9, 11)}`.trim();
}

module.exports = { isValidCPF, formatCPF };
