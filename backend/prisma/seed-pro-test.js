require('dotenv').config();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { normalizePrismaRuntimeUrl } = require('../src/config/databaseUrl');

process.env.DATABASE_URL = normalizePrismaRuntimeUrl(process.env.DATABASE_URL);
const prisma = new PrismaClient();

const email = String(process.env.PRO_TEST_EMAIL || 'teste.pro@financehub.local').trim().toLowerCase();
const defaultPassword = 'FinanceHubPro@2026';
const passwordWasProvided = Boolean(process.env.PRO_TEST_PASSWORD);
const password = String(process.env.PRO_TEST_PASSWORD || defaultPassword);
const name = String(process.env.PRO_TEST_NAME || 'Conta Pro Teste').trim();
const allowProduction = process.env.ALLOW_PRO_TEST_ACCOUNT === 'true';

async function main() {
  if (process.env.NODE_ENV === 'production' && !allowProduction) {
    throw new Error('Conta de teste bloqueada em produção. Defina ALLOW_PRO_TEST_ACCOUNT=true conscientemente para permitir.');
  }
  if (process.env.NODE_ENV === 'production' && (!passwordWasProvided || password === defaultPassword)) {
    throw new Error('Em produção/staging público, defina uma PRO_TEST_PASSWORD própria; a senha padrão é bloqueada.');
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
  console.log(`  e-mail: ${user.email}`);
  if (process.env.NODE_ENV === 'production') {
    console.log('  senha: definida por PRO_TEST_PASSWORD (não exibida no log)');
  } else {
    console.log(`  senha:  ${password}`);
  }
  console.log('Não use essas credenciais em produção pública.');
}

main()
  .catch((error) => { console.error(error); process.exit(1); })
  .finally(async () => prisma.$disconnect());
