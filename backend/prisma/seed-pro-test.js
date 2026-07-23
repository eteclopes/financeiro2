require('dotenv').config();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { normalizePrismaRuntimeUrl } = require('../src/config/databaseUrl');
const { maskEmail, sanitizeLogText } = require('../src/utils/privacy');

process.env.DATABASE_URL = normalizePrismaRuntimeUrl(process.env.DATABASE_URL);
const prisma = new PrismaClient();

const emailWasProvided = Boolean(process.env.PRO_TEST_EMAIL?.trim());
const email = String(process.env.PRO_TEST_EMAIL || 'teste.pro@financehub.local').trim().toLowerCase();
const password = String(process.env.PRO_TEST_PASSWORD || '');
const name = String(process.env.PRO_TEST_NAME || 'Conta Pro Teste').trim();
const allowProduction = process.env.ALLOW_PRO_TEST_ACCOUNT === 'true';

async function main() {
  if (process.env.NODE_ENV === 'production' && !allowProduction) {
    throw new Error('Conta de teste bloqueada em produção. Defina ALLOW_PRO_TEST_ACCOUNT=true conscientemente para permitir.');
  }
  if (process.env.NODE_ENV === 'production' && !emailWasProvided) {
    throw new Error('Em produção/staging público, PRO_TEST_EMAIL precisa ser definido explicitamente.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('PRO_TEST_EMAIL inválido.');
  }
  if (!password) {
    throw new Error('Defina PRO_TEST_PASSWORD; o projeto não possui mais senha padrão de teste.');
  }
  if (password.length < 12) throw new Error('PRO_TEST_PASSWORD precisa ter pelo menos 12 caracteres.');

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    create: {
      name,
      email,
      passwordHash,
      plan: 'pro',
      planSource: 'manual_test',
      planGrantedAt: new Date(),
      planExpiresAt: null,
    },
    update: {
      name,
      passwordHash,
      plan: 'pro',
      planSource: 'manual_test',
      planGrantedAt: new Date(),
      planExpiresAt: null,
    },
  });

  console.log('Conta Pro de teste pronta:');
  console.log(`  e-mail: ${maskEmail(user.email)}`);
  console.log('  senha: definida por PRO_TEST_PASSWORD (não exibida no log)');
  console.log('Não use essas credenciais em produção pública.');
}

main()
  .catch((error) => {
    console.error(`Falha ao preparar conta Pro (${sanitizeLogText(error?.code || error?.name || 'SEED_ERROR', 60)}).`);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
