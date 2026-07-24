-- ============================================================
-- Integridade financeira — compatível com dados existentes.
-- Nenhum DELETE de dado do usuário. Todo backfill é aditivo ou
-- corrige apenas duplicidades comprovadas.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Recorrência de receita: proteção no BANCO contra duplicidade
--    Antes existia apenas o advisory lock da aplicação. Se o lock
--    falhasse (retry, processo derrubado, deploy no meio), o mesmo
--    template podia gerar duas receitas no mesmo mês.
-- ------------------------------------------------------------

-- Backfill: bases antigas podem já ter duplicidade. Mantém a receita
-- MAIS ANTIGA de cada (template, mês) e desvincula as demais do
-- template — o lançamento continua existindo (nada de dinheiro é
-- apagado), apenas deixa de ser tratado como a ocorrência da
-- recorrência daquele mês.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY template_id, month_id
           ORDER BY created_at, id
         ) AS rn
  FROM "incomes"
  WHERE template_id IS NOT NULL
)
UPDATE "incomes" i
SET template_id = NULL
FROM ranked r
WHERE i.id = r.id AND r.rn > 1;

-- NULL é distinto de NULL no PostgreSQL, portanto receitas avulsas
-- (template_id IS NULL) não são afetadas por esta restrição.
CREATE UNIQUE INDEX IF NOT EXISTS "incomes_template_id_month_id_key"
  ON "incomes" ("template_id", "month_id");

-- ------------------------------------------------------------
-- 2) Versionamento real de snapshots de mês fechado
--    Um snapshot válido nunca mais é sobrescrito silenciosamente:
--    a versão anterior é arquivada aqui, com motivo e data.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "month_snapshot_versions" (
  "id"          BIGSERIAL PRIMARY KEY,
  "month_id"    BIGINT NOT NULL,
  "version"     SMALLINT NOT NULL,
  "snapshot"    JSONB NOT NULL,
  "reason"      VARCHAR(80) NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "month_snapshot_versions"
  DROP CONSTRAINT IF EXISTS "month_snapshot_versions_month_id_fkey";
ALTER TABLE "month_snapshot_versions"
  ADD CONSTRAINT "month_snapshot_versions_month_id_fkey"
  FOREIGN KEY ("month_id") REFERENCES "months"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "month_snapshot_versions_month_id_created_at_idx"
  ON "month_snapshot_versions" ("month_id", "created_at" DESC);

-- Preserva o que já existe: todo snapshot atual vira a versão 1 do
-- histórico, para que nenhuma reconstrução futura perca o original.
INSERT INTO "month_snapshot_versions" ("month_id", "version", "snapshot", "reason")
SELECT m."id", COALESCE(m."snapshot_version", 1), m."financial_snapshot", 'initial_backfill'
FROM "months" m
WHERE m."financial_snapshot" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "month_snapshot_versions" v WHERE v."month_id" = m."id"
  );

-- ------------------------------------------------------------
-- 3) Índices com evidência de uso
--    Cada índice abaixo corresponde a um WHERE real e quente:
--    _shared/balance.js (getBalanceComponents), dashboard.service.js
--    e history.service.js consultam exatamente estas colunas.
-- ------------------------------------------------------------

-- balance.js: expense.aggregate({ userId, deletedAt: null, paidAt: { lte } })
CREATE INDEX IF NOT EXISTS "expenses_user_id_paid_at_idx"
  ON "expenses" ("user_id", "paid_at");

-- balance.js: income.aggregate({ userId, incomeDate: { lte } })
CREATE INDEX IF NOT EXISTS "incomes_user_id_income_date_idx"
  ON "incomes" ("user_id", "income_date");

-- balance.js: savingsTransaction.aggregate({ userId, type, transactionDate })
CREATE INDEX IF NOT EXISTS "savings_transactions_user_id_transaction_date_idx"
  ON "savings_transactions" ("user_id", "transaction_date");

-- dashboard/snapshot: goalContribution.findMany({ monthId, goal: { userId } })
CREATE INDEX IF NOT EXISTS "goal_contributions_month_id_idx"
  ON "goal_contributions" ("month_id");

-- debts.getDebtIndicators: expense.findMany({ debtId IN (...), status IN (...) })
CREATE INDEX IF NOT EXISTS "expenses_debt_id_status_idx"
  ON "expenses" ("debt_id", "status");
