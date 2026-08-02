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
const prisma = require('./config/prisma');
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

const adminFrontendOrigin = env.ADMIN_FRONTEND_URL;

const corsPolicy = createOriginPolicy({
  configuredOrigins: parseConfiguredOrigins(
    [env.CORS_ORIGIN, env.FRONTEND_URL, adminFrontendOrigin].filter(Boolean).join(',')
  ),
  vercelProject: env.CORS_VERCEL_PROJECT,
  vercelTeam: env.CORS_VERCEL_TEAM,
  // Produção aceita SOMENTE a lista explícita de origens. Para liberar
  // previews contra um backend de staging, defina CORS_ALLOW_PREVIEWS=true
  // nesse ambiente — nunca no de produção.
  allowPreviews: env.NODE_ENV !== 'production' || env.CORS_ALLOW_PREVIEWS === true,
});

if (env.NODE_ENV !== 'test') {
  console.log(`[CORS] Origens permitidas: ${corsPolicy.exactOrigins.join(', ')}`);
}

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
    'X-Currency', 'X-Request-ID', 'X-Workspace-ID', 'X-Client-Date',
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
app.get('/health', async (req, res) => {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const migration = await prisma.$queryRaw`
      SELECT
        EXISTS (
          SELECT 1 FROM "_prisma_migrations"
          WHERE migration_name = '20260802180000_stabilization_v30'
            AND finished_at IS NOT NULL
            AND rolled_back_at IS NULL
        ) AS required_applied,
        (
          SELECT migration_name FROM "_prisma_migrations"
          WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
          ORDER BY finished_at DESC
          LIMIT 1
        ) AS latest_migration
    `;
    const requiredApplied = Boolean(migration?.[0]?.required_applied);
    const latestMigration = migration?.[0]?.latest_migration || null;
    // Uma migration futura não pode deixar o serviço artificialmente
    // indisponível; readiness exige a migration mínima da estabilização.
    const schemaReady = requiredApplied;
    return res.status(schemaReady ? 200 : 503).json({
      status: schemaReady ? 'ready' : 'migration_pending',
      database: 'ok',
      schema: latestMigration,
      requiredMigration: '20260802180000_stabilization_v30',
      version: 'v30',
      uptime: Math.floor(process.uptime()),
      latencyMs: Date.now() - startedAt,
    });
  } catch {
    return res.status(503).json({
      status: 'unavailable',
      database: 'unavailable',
      version: 'v30',
      uptime: Math.floor(process.uptime()),
      latencyMs: Date.now() - startedAt,
    });
  }
});

app.use('/api', routes);

app.use((req, res, next) => {
  next(new AppError('Rota não encontrada.', 404, 'NOT_FOUND'));
});

app.use(errorHandler);

module.exports = app;
