const { PrismaClient } = require('@prisma/client');
const env = require('./env');
const { normalizePrismaRuntimeUrl } = require('./databaseUrl');

// O Prisma lê DATABASE_URL ao criar o client. Normalizar antes da instanciação
// evita prepared statements incompatíveis com o Supabase Pooler. DIRECT_URL não
// é alterada e continua sendo usada pelo Prisma Migrate no schema.prisma.
process.env.DATABASE_URL = normalizePrismaRuntimeUrl(env.DATABASE_URL);

const prisma = new PrismaClient({
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

module.exports = prisma;
