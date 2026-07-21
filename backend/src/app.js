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

const app = express();

// ── Segurança ────────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false,
  hsts: env.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
}));

app.use(cors({
  origin: env.CORS_ORIGIN,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── Rate limit global ────────────────────────────────────────────────────────
app.set('trust proxy', 1);
app.use(globalLimiter);

// ── Body parsing ─────────────────────────────────────────────────────────────
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