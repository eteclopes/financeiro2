const { PrismaClient } = require('@prisma/client');
const env = require('./env');
const { normalizePrismaRuntimeUrl } = require('./databaseUrl');

process.env.DATABASE_URL = normalizePrismaRuntimeUrl(env.DATABASE_URL);

const prisma = new PrismaClient({
  // Em produção o Prisma não escreve eventos diretamente no console porque
  // mensagens do driver podem incluir estrutura de consulta. Erros seguem para
  // o errorHandler sanitizado da API.
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : [],
  // Interactive transactions do projeto executam locks e geração de parcelas.
  // O padrão curto do Prisma causava P2028 sob cold start/carga. O limite
  // continua finito para cancelar operações travadas sem deixar estado parcial.
  transactionOptions: { maxWait: 10_000, timeout: 30_000 },
});

module.exports = prisma;
