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

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
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
