const { PrismaClient } = require('@prisma/client');
const env = require('./env');

// Evita múltiplas instâncias do PrismaClient em hot-reload (nodemon) e
// concentra toda a configuração de logging do banco em um único lugar.
const prisma = new PrismaClient({
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

module.exports = prisma;
