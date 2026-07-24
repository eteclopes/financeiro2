/**
 * Métodos de pagamento — valor canônico.
 *
 * O banco preserva os valores legados (`pix`, `transfer`) para não quebrar
 * histórico, mas todos eles produzem EXATAMENTE o mesmo efeito financeiro:
 * sai do saldo da conta. Manter três rótulos para um único efeito era o que
 * criava "opções diferentes com o mesmo resultado" na interface.
 *
 * Regra: só existem três origens com efeito distinto —
 *   debit  -> saldo da conta   (canônico; absorve pix/transfer/debit)
 *   cash   -> dinheiro físico
 *   credit -> cartão de crédito (vai para a fatura)
 */
const ACCOUNT_BALANCE = 'debit';
const PHYSICAL_CASH = 'cash';
const CREDIT_CARD = 'credit';

const LEGACY_ACCOUNT_METHODS = new Set(['pix', 'transfer', 'debit']);

/**
 * Normaliza qualquer método recebido para o valor canônico gravado a partir
 * de agora. Lançamentos antigos continuam legíveis; apenas não são criados
 * novos registros com os rótulos redundantes.
 */
function normalizePaymentMethod(method, { allowCredit = true } = {}) {
  if (method === PHYSICAL_CASH) return PHYSICAL_CASH;
  if (method === CREDIT_CARD) return allowCredit ? CREDIT_CARD : ACCOUNT_BALANCE;
  if (LEGACY_ACCOUNT_METHODS.has(method)) return ACCOUNT_BALANCE;
  return ACCOUNT_BALANCE;
}

/** Origem da receita derivada do método (espécie x digital). */
function incomeOriginFor(method) {
  return method === PHYSICAL_CASH ? 'physical' : 'digital';
}

module.exports = {
  ACCOUNT_BALANCE,
  PHYSICAL_CASH,
  CREDIT_CARD,
  normalizePaymentMethod,
  incomeOriginFor,
};
