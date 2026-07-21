-- Correções estruturais do núcleo financeiro:
-- 1) remove o módulo de assinaturas, migrando recorrências úteis para despesas fixas;
-- 2) separa competência da despesa da referência da fatura;
-- 3) registra a data real do pagamento para saldo acumulado mensal confiável.

ALTER TABLE "expenses"
  ADD COLUMN "competence_month" SMALLINT,
  ADD COLUMN "competence_year" SMALLINT,
  ADD COLUMN "paid_at" DATE;

-- Preserva o dia real das receitas recorrentes. Antes, toda recorrência era
-- gerada automaticamente no dia 1, o que podia disponibilizar um salário
-- antes da data em que ele realmente entraria.
ALTER TABLE "income_templates" ADD COLUMN "income_day" SMALLINT;
UPDATE "income_templates" template
SET "income_day" = COALESCE((
  SELECT EXTRACT(DAY FROM income."income_date")::SMALLINT
  FROM "incomes" income
  WHERE income."template_id" = template."id"
  ORDER BY income."income_date", income."id"
  LIMIT 1
), 1);
ALTER TABLE "income_templates"
  ALTER COLUMN "income_day" SET DEFAULT 1,
  ALTER COLUMN "income_day" SET NOT NULL;

-- A data de vencimento das despesas fixas antigas representa a competência
-- com mais fidelidade do que month_id, pois lançamentos no cartão podiam ter
-- sido movidos para o mês da fatura.
UPDATE "expenses"
SET
  "competence_month" = EXTRACT(MONTH FROM "due_date")::SMALLINT,
  "competence_year" = EXTRACT(YEAR FROM "due_date")::SMALLINT
WHERE "fixed_template_id" IS NOT NULL;

-- Para dados históricos já pagos, updated_at é a melhor aproximação disponível
-- para o dia em que o pagamento foi registrado no sistema.
UPDATE "expenses"
SET "paid_at" = COALESCE("updated_at"::DATE, "due_date")
WHERE "paid_amount" > 0 OR "status" IN ('paid', 'settled', 'partial');

-- Converte assinaturas ativas/pausadas em despesas fixas antes de apagar a tabela.
CREATE TEMP TABLE "subscription_fixed_map" (
  "subscription_id" BIGINT PRIMARY KEY,
  "fixed_template_id" BIGINT NOT NULL
) ON COMMIT DROP;

DO $$
DECLARE
  sub RECORD;
  new_template_id BIGINT;
BEGIN
  FOR sub IN
    SELECT * FROM "subscriptions" WHERE "status" IN ('active', 'paused')
  LOOP
    INSERT INTO "fixed_expense_templates" (
      "user_id", "description", "category_id", "value", "due_day",
      "payment_method", "card_id", "active", "created_at", "updated_at"
    ) VALUES (
      sub."user_id", sub."description", sub."category_id", sub."value",
      EXTRACT(DAY FROM sub."next_charge_date")::SMALLINT,
      sub."payment_method", sub."card_id", sub."status" = 'active',
      sub."created_at", NOW()
    ) RETURNING "id" INTO new_template_id;

    INSERT INTO "subscription_fixed_map" ("subscription_id", "fixed_template_id")
    VALUES (sub."id", new_template_id);
  END LOOP;
END $$;

UPDATE "expenses" e
SET
  "fixed_template_id" = m."fixed_template_id",
  "competence_month" = COALESCE(e."competence_month", EXTRACT(MONTH FROM e."due_date")::SMALLINT),
  "competence_year" = COALESCE(e."competence_year", EXTRACT(YEAR FROM e."due_date")::SMALLINT)
FROM "subscription_fixed_map" m
WHERE e."subscription_id" = m."subscription_id";

UPDATE "expenses"
SET "type" = 'fixed'
WHERE "type" = 'subscription';

ALTER TABLE "expenses" DROP CONSTRAINT IF EXISTS "expenses_subscription_id_fkey";
ALTER TABLE "expenses" DROP COLUMN IF EXISTS "subscription_id";
DROP TABLE IF EXISTS "subscriptions";
DROP TYPE IF EXISTS "SubscriptionPeriodicity";
DROP TYPE IF EXISTS "SubscriptionStatus";

-- PostgreSQL não remove valores de enum diretamente: recria os enums sem os
-- itens obsoletos após converter/apagar os registros dependentes.
ALTER TYPE "ExpenseType" RENAME TO "ExpenseType_old";
CREATE TYPE "ExpenseType" AS ENUM ('priority', 'fixed', 'variable', 'card');
ALTER TABLE "expenses"
  ALTER COLUMN "type" TYPE "ExpenseType"
  USING "type"::TEXT::"ExpenseType";
DROP TYPE "ExpenseType_old";

DELETE FROM "simulations" WHERE "type" = 'cancel_subscription';
ALTER TYPE "SimulationType" RENAME TO "SimulationType_old";
CREATE TYPE "SimulationType" AS ENUM (
  'pay_debt', 'anticipate_installments', 'save_monthly',
  'reduce_category', 'increase_income'
);
ALTER TABLE "simulations"
  ALTER COLUMN "type" TYPE "SimulationType"
  USING "type"::TEXT::"SimulationType";
DROP TYPE "SimulationType_old";

-- Se uma base antiga já tiver duplicidades de recorrência, preserva o primeiro
-- lançamento e deixa os demais sem chave de competência para a migração não falhar.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY fixed_template_id, competence_month, competence_year
           ORDER BY created_at, id
         ) AS rn
  FROM "expenses"
  WHERE fixed_template_id IS NOT NULL
    AND competence_month IS NOT NULL
    AND competence_year IS NOT NULL
)
UPDATE "expenses" e
SET "competence_month" = NULL, "competence_year" = NULL
FROM ranked r
WHERE e.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX "expenses_fixed_template_competence_key"
  ON "expenses"("fixed_template_id", "competence_month", "competence_year");
CREATE INDEX "expenses_card_invoice_id_idx" ON "expenses"("card_invoice_id");
