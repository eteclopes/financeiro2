const env = require('../config/env');
const AppError = require('../utils/AppError');
const { sanitizeLogText, errorFingerprint } = require('../utils/privacy');

function logError(req, err, level = 'error') {
  const isTrustedOperationalError = err instanceof AppError;
  const entry = {
    level,
    timestamp: new Date().toISOString(),
    requestId: req.id ?? null,
    method: req.method,
    path: req.path,
    statusCode: err.statusCode ?? 500,
    code: sanitizeLogText(err.code ?? 'INTERNAL_ERROR', 80),
    // Em produção, exceções inesperadas de ORM/driver não têm a mensagem
    // gravada: ela pode conter nomes de colunas, argumentos ou valores.
    message: env.NODE_ENV === 'production' && !isTrustedOperationalError
      ? 'Unexpected server error'
      : sanitizeLogText(err.message, 300),
    fingerprint: errorFingerprint(err),
    ...(env.NODE_ENV !== 'production' ? { stack: err.stack } : {}),
  };

  if (env.NODE_ENV === 'production') {
    process.stderr.write(JSON.stringify(entry) + '\n');
  } else {
    const emoji = level === 'warn' ? '⚠' : '❌';
    console.error(`${emoji} [${entry.code}] ${entry.method} ${entry.path} — ${entry.message}`);
    if (entry.stack) console.error(entry.stack);
  }
}

function databaseOperationalError(err) {
  const message = String(err?.message || '');
  const meta = JSON.stringify(err?.meta || {});
  if (message.includes('MONTH_IMMUTABLE') || meta.includes('MONTH_IMMUTABLE')) {
    return new AppError(
      'Este período já foi encerrado e não pode ter seus fatos financeiros reescritos.',
      409,
      'MONTH_IMMUTABLE'
    );
  }
  const dbInvariantErrors = [
    ['INCOME_REVERSAL_REQUIRED', 'Esta receita já afetou um período encerrado. Faça um estorno em vez de excluí-la.', 'INCOME_REVERSAL_REQUIRED'],
    ['INCOME_CASH_EFFECT_IMMUTABLE', 'O efeito desta receita no caixa já pertence a um período encerrado.', 'INCOME_CASH_EFFECT_IMMUTABLE'],
    ['PAID_AT_IMMUTABLE', 'A data real de pagamento não pode ser reescrita depois de registrada.', 'PAID_AT_IMMUTABLE'],
    ['PAYMENT_AMOUNT_IMMUTABLE', 'O valor já pago não pode ser reduzido sem um estorno.', 'PAYMENT_AMOUNT_IMMUTABLE'],
    ['REVERSAL_DATE_IMMUTABLE', 'A data do estorno não pode ser alterada depois de registrada.', 'REVERSAL_DATE_IMMUTABLE'],
    ['REVERSAL_AMOUNT_IMMUTABLE', 'O valor estornado não pode ser reduzido depois de registrado.', 'REVERSAL_AMOUNT_IMMUTABLE'],
    ['CATEGORY_BUDGET_OWNER_MISMATCH', 'A categoria não pertence a esta conta ou não aceita orçamento de despesa.', 'CATEGORY_BUDGET_OWNER_MISMATCH'],
    ['incomes_nonnegative_values_ck', 'Os valores da receita ou do estorno são inválidos.', 'INCOME_VALUE_INVARIANT'],
    ['expenses_nonnegative_values_ck', 'Os valores da despesa, pagamento ou estorno são inválidos.', 'EXPENSE_VALUE_INVARIANT'],
  ];
  for (const [marker, userMessage, code] of dbInvariantErrors) {
    if (message.includes(marker) || meta.includes(marker)) {
      return new AppError(userMessage, 409, code);
    }
  }
  if (err?.code === 'P2002') {
    return new AppError('Já existe um registro com esses dados.', 409, 'DUPLICATE_RECORD');
  }
  if (err?.code === 'P2003') {
    return new AppError('A operação está bloqueada por dados financeiros relacionados.', 409, 'RELATED_RECORDS');
  }
  if (err?.code === 'P2028') {
    return new AppError('A operação financeira excedeu o tempo seguro. Tente novamente.', 503, 'TRANSACTION_TIMEOUT');
  }
  return null;
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const mapped = databaseOperationalError(err);
  if (mapped) return errorHandler(mapped, req, res, next);
  if (err instanceof AppError) {
    if (err.statusCode >= 500) logError(req, err, 'error');
    else if (env.NODE_ENV === 'development') logError(req, err, 'warn');
    return res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
      requestId: req.id,
    });
  }

  logError(req, err, 'error');
  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Erro interno do servidor.',
      ...(env.NODE_ENV !== 'production' ? { detail: err.message } : {}),
    },
    requestId: req.id,
  });
}

module.exports = errorHandler;
