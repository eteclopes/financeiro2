-- ═══════════════════════════════════════════════════════════════════════
-- CONTAS DO POSTGRESQL — FinançasHub
-- ═══════════════════════════════════════════════════════════════════════
-- Hoje a aplicação, as migrations e o acesso de emergência usam a MESMA
-- credencial. Isso significa que uma falha na aplicação (ex.: uma injeção de
-- SQL) teria poder para apagar tabelas. Separar em três papéis limita o
-- estrago de cada um ao mínimo necessário.
--
-- ORDEM DE APLICAÇÃO
--   1. Rodar como superusuário/owner do banco.
--   2. Trocar as senhas pelos valores gerados no gerenciador de segredos.
--   3. Rodar os testes de permissão do final deste arquivo.
--   4. Só então trocar a DATABASE_URL da aplicação.
--
-- NÃO execute em produção sem antes validar numa cópia.
-- ═══════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────
-- 1) financashub_app — usada pelo backend em runtime
-- ───────────────────────────────────────────────────────────────────────
CREATE ROLE financashub_app WITH LOGIN PASSWORD 'TROCAR_ME'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;

GRANT CONNECT ON DATABASE postgres TO financashub_app;
GRANT USAGE  ON SCHEMA public       TO financashub_app;

-- Apenas manipulação de dados. Nada de DDL.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO financashub_app;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO financashub_app;

-- Tabelas criadas por migrations futuras herdam as mesmas permissões.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO financashub_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO financashub_app;

-- Barreiras explícitas.
REVOKE CREATE ON SCHEMA public FROM financashub_app;

-- O log administrativo é append-only: nem a aplicação pode reescrever.
REVOKE UPDATE, DELETE ON TABLE audit_log FROM financashub_app;

-- ───────────────────────────────────────────────────────────────────────
-- 2) financashub_migration — usada SÓ no deploy de migrations
-- ───────────────────────────────────────────────────────────────────────
-- Precisa de DDL, então é a mais poderosa das duas de uso corrente. Fica
-- fora do processo que atende HTTP: é usada pelo passo de deploy e ponto.
CREATE ROLE financashub_migration WITH LOGIN PASSWORD 'TROCAR_ME'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

GRANT CONNECT ON DATABASE postgres TO financashub_migration;
GRANT USAGE, CREATE ON SCHEMA public TO financashub_migration;
GRANT ALL ON ALL TABLES    IN SCHEMA public TO financashub_migration;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO financashub_migration;

-- ───────────────────────────────────────────────────────────────────────
-- 3) financashub_breakglass — acesso de emergência
-- ───────────────────────────────────────────────────────────────────────
-- Nunca usada pelo backend nem guardada como DATABASE_URL. Fica lacrada no
-- gerenciador de segredos, com uso registrado fora do sistema e rotação
-- obrigatória depois de cada incidente.
CREATE ROLE financashub_breakglass WITH LOGIN PASSWORD 'TROCAR_ME'
  NOSUPERUSER NOCREATEDB NOCREATEROLE;

GRANT CONNECT ON DATABASE postgres TO financashub_breakglass;
GRANT USAGE ON SCHEMA public TO financashub_breakglass;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO financashub_breakglass;

-- ═══════════════════════════════════════════════════════════════════════
-- TESTES DE PERMISSÃO — rodar conectado como cada papel
-- ═══════════════════════════════════════════════════════════════════════
-- Como financashub_app, TODOS estes comandos devem FALHAR:
--   CREATE TABLE teste_permissao (id int);
--   DROP TABLE users;
--   ALTER TABLE users ADD COLUMN teste text;
--   CREATE ROLE invasor;
--   UPDATE audit_log SET action = 'x';
--   DELETE FROM audit_log;
--
-- E estes devem FUNCIONAR:
--   SELECT count(*) FROM users;
--   INSERT INTO categories (...) VALUES (...);
--
-- Como financashub_breakglass, apenas leitura deve funcionar:
--   SELECT count(*) FROM users;          -- ok
--   DELETE FROM users;                   -- deve falhar
