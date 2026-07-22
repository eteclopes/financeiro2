require('./utils/bigintJson');

const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');
const cookieParser = require('cookie-parser');
const morgan  = require('morgan');

const env         = require('./config/env');
const routes      = require('./routes');
const errorHandler = require('./middlewares/errorHandler');
const AppError    = require('./utils/AppError');
const { globalLimiter } = require('./middlewares/rateLimiters');
const { parseConfiguredOrigins, createOriginPolicy } = require('./utils/corsOrigins');
const billingController = require('./modules/billing/billing.controller');

const app = express();

// ── Segurança ────────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false,
  hsts: env.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
}));

const corsPolicy = createOriginPolicy({
  configuredOrigins: parseConfiguredOrigins(`${env.CORS_ORIGIN},${env.FRONTEND_URL}`),
  vercelProject: env.CORS_VERCEL_PROJECT,
  vercelTeam: env.CORS_VERCEL_TEAM,
});

app.use(cors({
  origin(origin, callback) {
    if (corsPolicy.isAllowed(origin)) {
      // Retornar a origem recebida faz o middleware emitir um cabeçalho válido
      // Access-Control-Allow-Origin, inclusive quando credentials=true.
      return callback(null, origin || true);
    }

    if (env.NODE_ENV !== 'test') {
      console.warn(`[CORS] Origem recusada: ${origin}`);
    }
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204,
}));

// ── Webhook Stripe / body parsing ────────────────────────────────────────────
// A assinatura do Stripe é calculada sobre os bytes originais. Por isso este
// endpoint precisa ser montado ANTES do express.json e receber Buffer bruto.
// Ele também fica antes do rate limit global: webhooks são servidor-servidor,
// possuem assinatura criptográfica e precisam aceitar as retentativas do
// Stripe sem risco de um pico da API bloquear a confirmação do pagamento.
app.post('/api/billing/webhook', express.raw({ type: 'application/json', limit: '1mb' }), billingController.webhook);

// ── Rate limit global ────────────────────────────────────────────────────────
app.set('trust proxy', 1);
app.use(globalLimiter);

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// ── Logging ──────────────────────────────────────────────────────────────────
if (env.NODE_ENV !== 'test') {
  app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), env: env.NODE_ENV });
});

// ── Rotas da API ─────────────────────────────────────────────────────────────
app.use('/api', routes);

// ── 404 ──────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  next(new AppError(`Rota não encontrada: ${req.method} ${req.originalUrl}`, 404, 'NOT_FOUND'));
});

// ── Erros ────────────────────────────────────────────────────────────────────
app.use(errorHandler);

module.exports = app;