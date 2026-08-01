require('dotenv').config();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { normalizePrismaRuntimeUrl } = require('../src/config/databaseUrl');
const { maskEmail, sanitizeLogText } = require('../src/utils/privacy');

process.env.DATABASE_URL = normalizePrismaRuntimeUrl(process.env.DATABASE_URL);
const prisma = new PrismaClient();

const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const password = String(process.env.ADMIN_PASSWORD || '');
const name = String(process.env.ADMIN_NAME || 'Administrador').trim();

async function main() {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Defina ADMIN_EMAIL com um e-mail válido.');
  }
  if (password.length < 12) {
    throw new Error('ADMIN_PASSWORD precisa ter pelo menos 12 caracteres.');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    create: {
      name,
      email,
      passwordHash,
      role: 'admin',
      plan: 'pro',
      planSource: 'manual_admin',
      planGrantedAt: new Date(),
      planExpiresAt: null,
    },
    update: { name, passwordHash, role: 'admin' },
  });

  console.log(`Administrador pronto: ${maskEmail(user.email)}`);
  console.log('A senha foi lida de ADMIN_PASSWORD e não foi exibida.');
}

main()
  .catch((error) => {
    console.error(`Falha ao preparar administrador (${sanitizeLogText(error?.message || 'SEED_ERROR', 120)}).`);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
