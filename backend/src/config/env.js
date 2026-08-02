const { z } = require('zod');
require('dotenv').config();

// Falhar rápido na inicialização caso falte alguma variável crítica —
// é preferível o servidor não subir a subir mal configurado em produção.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3333),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
  // schema.prisma declara `directUrl = env("DIRECT_URL")` (necessário para o
  // pooler do Supabase). Se essa env var não existir, `prisma generate`,
  // `prisma migrate dev/deploy` falham imediatamente — inclusive no build de
  // produção (Render/Railway roda `prisma generate && prisma migrate deploy`).
  // Validar aqui também garante que o servidor Node falhe rápido e com uma
  // mensagem clara, em vez de deixar o erro só aparecer no CLI do Prisma.
  DIRECT_URL: z.string().min(1, 'DIRECT_URL é obrigatória (conexão direta, sem pooler, usada pelo Prisma Migrate)'),
  CORS_ORIGIN: z.string().min(1, 'CORS_ORIGIN é obrigatória'),
  // Opcionais: permitem os URLs automáticos de Preview da Vercel apenas para
  // este projeto/equipe, sem abrir a API para qualquer domínio vercel.app.
  CORS_VERCEL_PROJECT: z.string().optional(),
  CORS_VERCEL_TEAM: z.string().optional(),
  // Em produção, previews automáticos da Vercel ficam BLOQUEADOS por
  // padrão. Só um ambiente de staging deve ligar isto.
  CORS_ALLOW_PREVIEWS: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
  // 32+ caracteres é o mínimo recomendado para HS256 (256 bits de entropia
  // quando gerado com `openssl rand -hex 32`, por exemplo). 16 caracteres
  // era fraco demais para um segredo assinando tokens de sessão.
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET deve ter pelo menos 32 caracteres'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_ISSUER: z.string().min(3).default('financehub-api'),
  JWT_AUDIENCE: z.string().min(3).default('financehub-web'),
  JWT_ADMIN_AUDIENCE: z.string().min(3).default('financehub-admin'),
  JWT_REFRESH_EXPIRES_IN_DAYS: z.coerce.number().default(30),
  PASSWORD_RESET_EXPIRES_IN_HOURS: z.coerce.number().default(1),

  // ── E-mail transacional (recuperação de senha) ──────────────────────
  // O servidor pode subir sem SMTP para ambientes que não oferecem
  // recuperação de senha. Em produção, o endpoint falha com 503 se a entrega
  // não estiver disponível; nunca responde sucesso fictício.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('FinançasPro <no-reply@financaspro.app>'),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  ADMIN_FRONTEND_URL: z.string().url().optional(),

  // ── Plano Pro vitalício / Stripe Checkout ───────────────────────────
  // Permanecem opcionais para o app continuar subindo enquanto a conta
  // Stripe ainda não foi conectada. O endpoint de checkout informa
  // claramente quando as três chaves abaixo ainda não estão configuradas.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRO_LIFETIME_PRICE_ID: z.string().optional(),
  STRIPE_API_BASE: z.string().url().default('https://api.stripe.com'),
  STRIPE_API_VERSION: z.string().default('2026-06-24.dahlia'),
  PRO_LIFETIME_PRICE_LABEL: z.string().default('Oferta vitalícia'),
});

const parsed = envSchema.superRefine((value, ctx) => {
  if (value.NODE_ENV === 'production' && !value.ADMIN_FRONTEND_URL) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['ADMIN_FRONTEND_URL'],
      message: 'ADMIN_FRONTEND_URL é obrigatória em produção',
    });
  }
  if (value.NODE_ENV === 'production' && value.FRONTEND_URL.includes('localhost')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['FRONTEND_URL'],
      message: 'FRONTEND_URL deve apontar para o domínio de produção',
    });
  }
}).safeParse(process.env);

if (!parsed.success) {
  console.error('Variáveis de ambiente inválidas:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const { getDatabaseTransportIssue } = require('./databaseUrl');
const databaseIssues = [
  ['DATABASE_URL', getDatabaseTransportIssue(parsed.data.DATABASE_URL, parsed.data.NODE_ENV)],
  ['DIRECT_URL', getDatabaseTransportIssue(parsed.data.DIRECT_URL, parsed.data.NODE_ENV)],
].filter(([, issue]) => issue);

if (databaseIssues.length) {
  console.error('Configuração insegura de banco de dados:');
  for (const [name, issue] of databaseIssues) console.error(`- ${name}: ${issue}`);
  process.exit(1);
}

module.exports = parsed.data;
