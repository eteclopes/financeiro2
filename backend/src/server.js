const app = require('./app');
const env = require('./config/env');
const prisma = require('./config/prisma');

const server = app.listen(env.PORT, () => {
  console.log(`API rodando em http://localhost:${env.PORT} [${env.NODE_ENV}]`);
});

// Encerramento gracioso: fecha conexões com o banco antes de matar o processo,
// evitando queries em andamento serem cortadas abruptamente.
async function shutdown(signal) {
  console.log(`\n${signal} recebido. Encerrando...`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
