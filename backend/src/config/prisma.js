const { PrismaClient } = require('@prisma/client');
const env = require('./env');
const { normalizePrismaRuntimeUrl } = require('./databaseUrl');

process.env.DATABASE_URL = normalizePrismaRuntimeUrl(env.DATABASE_URL);

const prisma = new PrismaClient({
  // Em produção o Prisma não escreve eventos diretamente no console porque
  // mensagens do driver podem incluir estrutura de consulta. Erros seguem para
  // o errorHandler sanitizado da API.
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : [],
});

module.exports = prisma;
