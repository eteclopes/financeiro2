const crypto = require('node:crypto');
const morgan = require('morgan');
const AppError = require('../utils/AppError');
const { sanitizeLogText } = require('../utils/privacy');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

function requestId(req, res, next) {
  const supplied = req.get('x-request-id');
  req.id = REQUEST_ID_PATTERN.test(supplied || '') ? supplied : crypto.randomUUID();
  res.setHeader('X-Request-ID', req.id);
  next();
}

function privateApiHeaders(req, res, next) {
  if (req.path !== '/health') {
    // Dados financeiros e tokens nunca devem ficar em caches do navegador,
    // proxies compartilhados ou histórico de respostas intermediárias.
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  next();
}

function enforceTrustedOrigin(originPolicy) {
  return function trustedOriginGuard(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();
    // Webhook é autenticado pela assinatura Stripe e normalmente não envia Origin.
    if (req.path === '/api/billing/webhook') return next();

    const origin = req.get('origin');
    if (origin && !originPolicy.isAllowed(origin)) {
      throw new AppError('Origem da requisição não autorizada.', 403, 'ORIGIN_NOT_ALLOWED');
    }
    return next();
  };
}

morgan.token('request-id', (req) => req.id || '-');
morgan.token('safe-path', (req) => sanitizeLogText(req.path || '/', 180));

function privacyLogger(environment) {
  if (environment === 'test') return (_req, _res, next) => next();

  // Não registra IP, query string, Referer, User-Agent, e-mail, valores ou body.
  // Mantém apenas informação operacional suficiente para suporte e incidentes.
  const format = ':method :safe-path :status :res[content-length] - :response-time ms requestId=:request-id';
  return morgan(format, {
    skip: (req) => req.path === '/health',
  });
}

module.exports = {
  requestId,
  privateApiHeaders,
  enforceTrustedOrigin,
  privacyLogger,
};
