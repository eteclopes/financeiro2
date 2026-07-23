require('./utils/bigintJson');

const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');
const cookieParser = require('cookie-parser');

const env         = require('./config/env');
const routes      = require('./routes');
const errorHandler = require('./middlewares/errorHandler');
const AppError    = require('./utils/AppError');
const { globalLimiter } = require('./middlewares/rateLimiters');
const { parseConfiguredOrigins, createOriginPolicy } = require('./utils/corsOrigins');
const billingController = require('./modules/billing/billing.controller');
const { localizationContext } = require('./utils/requestContext');
const {
  requestId,
  privateApiHeaders,
  enforceTrustedOrigin,
  privacyLogger,
} = require('./middlewares/security');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(requestId);
app.use(helmet({
  contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  referrerPolicy: { policy: 'no-referrer' },
  hsts: env.NODE_ENV === 'production'
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false,
}));
app.use(privateApiHeaders);

const corsPolicy = createOriginPolicy({
  configuredOrigins: parseConfiguredOrigins(`${env.CORS_ORIGIN},${env.FRONTEND_URL}`),
  vercelProject: env.CORS_VERCEL_PROJECT,
  vercelTeam: env.CORS_VERCEL_TEAM,
});

app.use(cors({
  origin(origin, callback) {
    if (corsPolicy.isAllowed(origin)) return callback(null, origin || true);
    if (env.NODE_ENV !== 'test') console.warn('[CORS] Origem recusada.');
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 'Authorization', 'Accept-Language', 'X-Time-Zone',
    'X-Currency', 'X-Request-ID',
  ],
  exposedHeaders: ['X-Request-ID', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset'],
  optionsSuccessStatus: 204,
  maxAge: 600,
}));

// CORS controla leitura pelo navegador, mas sozinho não impede que um POST
// simples alcance o servidor. O guard abaixo rejeita origens não confiáveis
// antes de executar qualquer mutação, reduzindo CSRF nas rotas com cookie.
app.use(enforceTrustedOrigin(corsPolicy));

// Webhook precisa dos bytes originais e fica fora do limitador global.
app.post('/api/billing/webhook', express.raw({ type: 'application/json', limit: '1mb' }), billingController.webhook);

app.use(globalLimiter);
app.use(express.json({ limit: '256kb', strict: true }));
app.use(cookieParser());
app.use(localizationContext);
app.use(privacyLogger(env.NODE_ENV));

app.get('/', (req, res) => res.status(204).send());
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: Math.floor(process.uptime()) });
});

app.use('/api', routes);

app.use((req, res, next) => {
  next(new AppError('Rota não encontrada.', 404, 'NOT_FOUND'));
});

app.use(errorHandler);

module.exports = app;
