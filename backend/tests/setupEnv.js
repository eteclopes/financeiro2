/**
 * `config/env.js` faz `process.exit(1)` se alguma variável obrigatória
 * faltar/for inválida — correto em produção, mas mataria o processo do
 * Jest inteiro se um teste (mesmo indiretamente) exigisse esse módulo sem
 * as variáveis presentes. `config/env.js` também chama `dotenv.config()`,
 * que carregaria o `.env` REAL do projeto — e ali o `DIRECT_URL` está de
 * propósito vazio (placeholder pendente, ver AUDITORIA-CLAUDE.md), o que
 * faria os testes falharem por um motivo que não tem nada a ver com o
 * teste em si. dotenv não sobrescreve variáveis que já existem em
 * process.env, então definir tudo aqui primeiro (setupFiles roda antes de
 * qualquer require de teste) garante testes determinísticos e isolados do
 * `.env` real.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test_db';
process.env.DIRECT_URL = 'postgresql://test:test@localhost:5432/test_db';
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-secret-com-32-caracteres-no-minimo-ok';

process.env.JWT_ISSUER = 'financehub-api';
process.env.JWT_AUDIENCE = 'financehub-web';
