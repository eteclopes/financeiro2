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
  // 32+ caracteres é o mínimo recomendado para HS256 (256 bits de entropia
  // quando gerado com `openssl rand -hex 32`, por exemplo). 16 caracteres
  // era fraco demais para um segredo assinando tokens de sessão.
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET deve ter pelo menos 32 caracteres'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN_DAYS: z.coerce.number().default(30),
  PASSWORD_RESET_EXPIRES_IN_HOURS: z.coerce.number().default(1),

  // ── E-mail transacional (recuperação de senha) ──────────────────────
  // Todas opcionais: se SMTP_HOST não estiver definido, o mailer apenas
  // loga um aviso e não envia e-mail de verdade (comportamento de dev),
  // em vez de derrubar o servidor. Em produção, configure um provedor
  // como Resend, SendGrid, Amazon SES ou qualquer SMTP compatível.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('FinançasPro <no-reply@financaspro.app>'),
  FRONTEND_URL: z.string().default('http://localhost:5173'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Variáveis de ambiente inválidas:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

module.exports = parsed.data;
