const rateLimit = require('express-rate-limit');

function response(message) {
  return { error: { code: 'TOO_MANY_REQUESTS', message } };
}

const common = {
  standardHeaders: true,
  legacyHeaders: false,
};

const authLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: 20,
  message: response('Muitas tentativas. Tente novamente mais tarde.'),
});

const sessionLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: 90,
  message: response('Muitas renovações de sessão. Aguarde alguns minutos.'),
});

const billingLimiter = rateLimit({
  ...common,
  windowMs: 10 * 60 * 1000,
  limit: 10,
  message: response('Muitas tentativas de pagamento. Aguarde antes de tentar novamente.'),
});

const globalLimiter = rateLimit({
  ...common,
  windowMs: 60 * 1000,
  limit: 300,
  skip: (req) => req.path === '/health',
  message: response('Limite de requisições atingido. Aguarde 1 minuto.'),
});

const heavyLimiter = rateLimit({
  ...common,
  windowMs: 60 * 1000,
  limit: 30,
  message: response('Muitas requisições para este endpoint. Aguarde.'),
});

module.exports = { authLimiter, sessionLimiter, billingLimiter, globalLimiter, heavyLimiter };
