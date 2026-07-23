/**
 * Métodos exibidos ao usuário.
 *
 * O banco mantém os valores legados (pix/debit/transfer) para não quebrar o
 * histórico, mas todos eles representam a mesma origem financeira: saldo da
 * conta. Novos lançamentos usam `debit` como valor canônico.
 */
export const ACCOUNT_BALANCE_METHOD = 'debit';
export const CREDIT_CARD_METHOD = 'credit';
export const PHYSICAL_CASH_METHOD = 'cash';

export const ACCOUNT_BALANCE_OPTION = {
  value: ACCOUNT_BALANCE_METHOD,
  label: 'Saldo da conta',
  icon: '▣',
  description: 'Usa o saldo disponível',
  tone: 'choice-card-icon-info',
};

export const CREDIT_CARD_OPTION = {
  value: CREDIT_CARD_METHOD,
  label: 'Cartão de crédito',
  icon: '◇',
  description: 'Vai para a fatura',
  tone: 'choice-card-icon-warning',
};

export const PHYSICAL_CASH_OPTION = {
  value: PHYSICAL_CASH_METHOD,
  label: 'Dinheiro físico',
  icon: '●',
  description: 'Pagamento em espécie',
  tone: 'choice-card-icon-success',
};

export const RECEIPT_OPTIONS = [
  {
    ...ACCOUNT_BALANCE_OPTION,
    description: 'Entrada no saldo disponível',
  },
  {
    ...PHYSICAL_CASH_OPTION,
    description: 'Dinheiro em mãos',
  },
];

export const BALANCE_PAYMENT_OPTIONS = [ACCOUNT_BALANCE_OPTION, PHYSICAL_CASH_OPTION];

export function getExpensePaymentOptions(cards = []) {
  const hasActiveCard = cards.some((card) => card?.active !== false);
  return hasActiveCard
    ? [ACCOUNT_BALANCE_OPTION, CREDIT_CARD_OPTION, PHYSICAL_CASH_OPTION]
    : BALANCE_PAYMENT_OPTIONS;
}

export function normalizePaymentMethod(method, { allowCredit = true } = {}) {
  if (method === PHYSICAL_CASH_METHOD) return PHYSICAL_CASH_METHOD;
  if (allowCredit && method === CREDIT_CARD_METHOD) return CREDIT_CARD_METHOD;
  return ACCOUNT_BALANCE_METHOD;
}

export function incomeOriginForPaymentMethod(method) {
  return method === PHYSICAL_CASH_METHOD ? 'physical' : 'digital';
}

export function getPaymentMethodLabel(method) {
  if (method === PHYSICAL_CASH_METHOD) return 'Dinheiro físico';
  if (method === CREDIT_CARD_METHOD) return 'Cartão de crédito';
  return 'Saldo da conta';
}
