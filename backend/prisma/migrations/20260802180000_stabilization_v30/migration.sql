-- V30: estabilização de tempo, sessões, histórico e orçamentos.
CREATE TYPE "AuthClient" AS ENUM ('user_app', 'admin_app');
ALTER TYPE "ExpenseStatus" ADD VALUE IF NOT EXISTS 'reversed';

ALTER TABLE "users"
  ADD COLUMN "timezone" VARCHAR(80) NOT NULL DEFAULT 'America/Sao_Paulo';

ALTER TABLE "simulation_workspaces"
  ADD COLUMN "current_date" DATE,
  ADD COLUMN "initial_balance" DECIMAL(12,2) NOT NULL DEFAULT 0;
UPDATE "simulation_workspaces"
SET "current_date" = make_date("start_year", "start_month", 1)
WHERE "current_date" IS NULL;
ALTER TABLE "simulation_workspaces" ALTER COLUMN "current_date" SET NOT NULL;

ALTER TABLE "refresh_tokens"
  ADD COLUMN "client" "AuthClient" NOT NULL DEFAULT 'user_app';
CREATE INDEX "refresh_tokens_user_client_revoked_idx"
  ON "refresh_tokens"("user_id", "client", "revoked_at");

ALTER TABLE "incomes"
  ADD COLUMN "effective_date" DATE;
UPDATE "incomes" i
SET "effective_date" = ((i."created_at" AT TIME ZONE 'UTC') AT TIME ZONE u."timezone")::date
FROM "users" u
WHERE i."user_id" = u."id" AND i."effective_date" IS NULL;
ALTER TABLE "incomes" ALTER COLUMN "effective_date" SET NOT NULL;
ALTER TABLE "incomes" ALTER COLUMN "effective_date" SET DEFAULT CURRENT_DATE;
ALTER TABLE "incomes"
  ADD COLUMN "reversed_at" DATE,
  ADD COLUMN "reversed_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;
CREATE INDEX "incomes_user_id_effective_date_idx"
  ON "incomes"("user_id", "effective_date");
CREATE INDEX "incomes_user_id_reversed_at_idx"
  ON "incomes"("user_id", "reversed_at");

ALTER TABLE "expenses"
  ADD COLUMN "reversed_at" DATE,
  ADD COLUMN "reversed_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;
CREATE INDEX "expenses_user_id_reversed_at_idx"
  ON "expenses"("user_id", "reversed_at");

CREATE TABLE "category_budgets" (
  "id" BIGSERIAL NOT NULL,
  "user_id" BIGINT NOT NULL,
  "category_id" BIGINT NOT NULL,
  "monthly_limit" DECIMAL(12,2) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "category_budgets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "category_budgets_user_id_category_id_key"
  ON "category_budgets"("user_id", "category_id");
CREATE INDEX "category_budgets_user_id_idx" ON "category_budgets"("user_id");
ALTER TABLE "category_budgets"
  ADD CONSTRAINT "category_budgets_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "category_budgets"
  ADD CONSTRAINT "category_budgets_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "category_budgets"
  ADD CONSTRAINT "category_budgets_positive_limit_ck" CHECK ("monthly_limit" > 0);
ALTER TABLE "incomes"
  ADD CONSTRAINT "incomes_nonnegative_values_ck" CHECK ("value" >= 0 AND "reversed_amount" >= 0 AND "reversed_amount" <= "value"),
  ADD CONSTRAINT "incomes_reversal_consistency_ck" CHECK (("reversed_amount" = 0 AND "reversed_at" IS NULL) OR ("reversed_amount" > 0 AND "reversed_at" IS NOT NULL));
ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_nonnegative_values_ck" CHECK ("value" >= 0 AND "paid_amount" >= 0 AND "reversed_amount" >= 0 AND "reversed_amount" <= "paid_amount" AND "residual_amount" >= 0),
  ADD CONSTRAINT "expenses_reversal_consistency_ck" CHECK (("reversed_amount" = 0 AND "reversed_at" IS NULL) OR ("reversed_amount" > 0 AND "reversed_at" IS NOT NULL));

CREATE OR REPLACE FUNCTION financehub_guard_category_budget_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_category_user BIGINT;
  v_category_type "CategoryType";
BEGIN
  SELECT "user_id", "type" INTO v_category_user, v_category_type
  FROM "categories" WHERE "id" = NEW."category_id";
  IF NOT FOUND OR v_category_type <> 'expense' OR (v_category_user IS NOT NULL AND v_category_user <> NEW."user_id") THEN
    RAISE EXCEPTION 'CATEGORY_BUDGET_OWNER_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_category_budget_owner ON "category_budgets";
CREATE TRIGGER trg_guard_category_budget_owner
BEFORE INSERT OR UPDATE ON "category_budgets"
FOR EACH ROW EXECUTE FUNCTION financehub_guard_category_budget_owner();

-- Migra limites já salvos em categorias próprias. Limites de categorias globais
-- eram compartilhados indevidamente e não são copiados automaticamente.
INSERT INTO "category_budgets" ("user_id", "category_id", "monthly_limit", "created_at", "updated_at")
SELECT "user_id", "id", "monthly_limit", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "categories"
WHERE "user_id" IS NOT NULL AND "monthly_limit" IS NOT NULL
ON CONFLICT ("user_id", "category_id") DO UPDATE
SET "monthly_limit" = EXCLUDED."monthly_limit", "updated_at" = CURRENT_TIMESTAMP;

-- CategoryBudget passa a ser a única fonte de verdade do orçamento.
ALTER TABLE "categories" DROP COLUMN IF EXISTS "monthly_limit";

-- Leitura de poupança deve ser pura. Garante a caixinha padrão para contas
-- existentes nesta migration; novas contas a criam no mesmo fluxo de cadastro.
INSERT INTO "savings_buckets"
  ("user_id", "kind", "name", "target_value", "is_default", "is_archived", "created_at", "updated_at")
SELECT u."id", 'general', NULL, NULL, true, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "users" u
WHERE NOT EXISTS (
  SELECT 1 FROM "savings_buckets" sb
  WHERE sb."user_id" = u."id" AND sb."is_default" = true
)
ON CONFLICT DO NOTHING;

-- Proteção transversal: nenhuma rota pode inserir ou reescrever a estrutura
-- financeira de um mês anterior/fechado. Pagamentos e estornos de obrigações
-- antigas continuam permitidos, pois são fatos do caixa atual.
CREATE OR REPLACE FUNCTION financehub_financial_date_for_user(p_user_id BIGINT)
RETURNS DATE
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_is_simulation BOOLEAN;
  v_simulation_date DATE;
  v_timezone TEXT;
BEGIN
  SELECT "is_simulation_profile", "timezone" INTO v_is_simulation, v_timezone
  FROM "users" WHERE "id" = p_user_id;

  IF COALESCE(v_is_simulation, FALSE) THEN
    SELECT "current_date" INTO v_simulation_date
    FROM "simulation_workspaces" WHERE "profile_user_id" = p_user_id;
    IF v_simulation_date IS NULL THEN
      RAISE EXCEPTION 'Simulation clock unavailable for profile %', p_user_id
        USING ERRCODE = 'P0001';
    END IF;
    RETURN v_simulation_date;
  END IF;

  IF v_timezone IS NULL OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_timezone) THEN
    v_timezone := 'America/Sao_Paulo';
  END IF;
  RETURN (CURRENT_TIMESTAMP AT TIME ZONE v_timezone)::DATE;
END;
$$;

CREATE OR REPLACE FUNCTION financehub_month_is_immutable(p_user_id BIGINT, p_month_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_status "MonthStatus";
  v_month INTEGER;
  v_year INTEGER;
  v_today DATE;
BEGIN
  SELECT "status", "month", "year" INTO v_status, v_month, v_year
  FROM "months" WHERE "id" = p_month_id AND "user_id" = p_user_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  v_today := financehub_financial_date_for_user(p_user_id);
  RETURN v_status = 'closed'
    OR make_date(v_year, v_month, 1) < date_trunc('month', v_today)::DATE;
END;
$$;

CREATE OR REPLACE FUNCTION financehub_date_is_immutable(p_user_id BIGINT, p_date DATE)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_status "MonthStatus";
  v_today DATE;
BEGIN
  v_today := financehub_financial_date_for_user(p_user_id);
  SELECT "status" INTO v_status FROM "months"
  WHERE "user_id" = p_user_id
    AND "month" = EXTRACT(MONTH FROM p_date)::INT
    AND "year" = EXTRACT(YEAR FROM p_date)::INT;
  RETURN COALESCE(v_status = 'closed', FALSE)
    OR date_trunc('month', p_date)::DATE < date_trunc('month', v_today)::DATE;
END;
$$;

CREATE OR REPLACE FUNCTION financehub_guard_income_month()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_old_month_immutable BOOLEAN := FALSE;
  v_new_month_immutable BOOLEAN := FALSE;
  v_old_effect_immutable BOOLEAN := FALSE;
  v_new_effect_immutable BOOLEAN := FALSE;
  v_is_simulation BOOLEAN := FALSE;
  v_financial_date DATE;
  v_old_struct JSONB;
  v_new_struct JSONB;
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('financehub.allow_ledger_delete', true) = 'on' THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT "is_simulation_profile" INTO v_is_simulation
    FROM "users" WHERE "id" = NEW."user_id";
    v_financial_date := financehub_financial_date_for_user(NEW."user_id");

    -- No ledger real toda receita nasce com efeito imediato na data financeira
    -- da operação. Simulações podem reconstruir deterministicamente datas
    -- futuras, mas nunca inserir um novo efeito em período já imutável.
    IF NOT COALESCE(v_is_simulation, FALSE)
       AND NEW."effective_date" IS DISTINCT FROM v_financial_date THEN
      RAISE EXCEPTION 'INCOME_EFFECT_DATE_INVALID'
        USING ERRCODE = 'P0001', DETAIL = 'Real income must affect cash on the current financial date';
    END IF;
    IF financehub_date_is_immutable(NEW."user_id", NEW."effective_date") THEN
      RAISE EXCEPTION 'INCOME_CASH_EFFECT_IMMUTABLE'
        USING ERRCODE = 'P0001', DETAIL = 'A new income cannot be backdated into an immutable cash period';
    END IF;
    IF financehub_month_is_immutable(NEW."user_id", NEW."month_id")
       AND NEW."template_id" IS NULL THEN
      RAISE EXCEPTION 'MONTH_IMMUTABLE'
        USING ERRCODE = 'P0001', DETAIL = 'Income belongs to a closed or elapsed month';
    END IF;
    RETURN NEW;
  END IF;

  v_old_month_immutable := financehub_month_is_immutable(OLD."user_id", OLD."month_id");
  v_old_effect_immutable := financehub_date_is_immutable(OLD."user_id", OLD."effective_date");

  IF TG_OP = 'DELETE' THEN
    IF v_old_month_immutable OR v_old_effect_immutable THEN
      RAISE EXCEPTION 'INCOME_REVERSAL_REQUIRED'
        USING ERRCODE = 'P0001', DETAIL = 'Income already affected an immutable cash period and must be reversed';
    END IF;
    RETURN OLD;
  END IF;

  v_new_month_immutable := financehub_month_is_immutable(NEW."user_id", NEW."month_id");
  v_new_effect_immutable := financehub_date_is_immutable(NEW."user_id", NEW."effective_date");

  -- Se a competência já foi encerrada, apenas o estorno pode evoluir.
  IF v_old_month_immutable OR v_new_month_immutable THEN
    v_old_struct := to_jsonb(OLD) - ARRAY['reversed_at','reversed_amount','updated_at'];
    v_new_struct := to_jsonb(NEW) - ARRAY['reversed_at','reversed_amount','updated_at'];
    IF v_old_struct IS DISTINCT FROM v_new_struct THEN
      RAISE EXCEPTION 'MONTH_IMMUTABLE'
        USING ERRCODE = 'P0001', DETAIL = 'Closed-month income can only be reversed';
    END IF;
  -- Se só o efeito no caixa já virou histórico, metadados/competência futura
  -- ainda podem ser organizados, mas valor/origem/data efetiva não mudam.
  ELSIF v_old_effect_immutable OR v_new_effect_immutable THEN
    IF OLD."user_id" IS DISTINCT FROM NEW."user_id"
       OR OLD."value" IS DISTINCT FROM NEW."value"
       OR OLD."payment_method" IS DISTINCT FROM NEW."payment_method"
       OR OLD."origin" IS DISTINCT FROM NEW."origin"
       OR OLD."effective_date" IS DISTINCT FROM NEW."effective_date" THEN
      RAISE EXCEPTION 'INCOME_CASH_EFFECT_IMMUTABLE'
        USING ERRCODE = 'P0001', DETAIL = 'Income cash effect is historical; reverse and recreate to change it';
    END IF;
  END IF;

  IF OLD."reversed_at" IS NOT NULL AND NEW."reversed_at" IS DISTINCT FROM OLD."reversed_at" THEN
    RAISE EXCEPTION 'REVERSAL_DATE_IMMUTABLE'
      USING ERRCODE = 'P0001', DETAIL = 'Recorded reversal date cannot be rewritten';
  END IF;
  IF NEW."reversed_amount" < OLD."reversed_amount" THEN
    RAISE EXCEPTION 'REVERSAL_AMOUNT_IMMUTABLE'
      USING ERRCODE = 'P0001', DETAIL = 'Recorded reversal amount cannot decrease';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION financehub_guard_expense_month()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_old_immutable BOOLEAN := FALSE;
  v_new_immutable BOOLEAN := FALSE;
  v_old_struct JSONB;
  v_new_struct JSONB;
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('financehub.allow_ledger_delete', true) = 'on' THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_new_immutable := financehub_month_is_immutable(NEW."user_id", NEW."month_id");
    IF v_new_immutable
       AND NEW."fixed_template_id" IS NULL
       AND NEW."debt_id" IS NULL THEN
      RAISE EXCEPTION 'MONTH_IMMUTABLE'
        USING ERRCODE = 'P0001', DETAIL = 'Expense belongs to a closed or elapsed month';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF financehub_month_is_immutable(OLD."user_id", OLD."month_id") THEN
      RAISE EXCEPTION 'MONTH_IMMUTABLE'
        USING ERRCODE = 'P0001', DETAIL = 'Expense from a closed or elapsed month cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  v_old_immutable := financehub_month_is_immutable(OLD."user_id", OLD."month_id");
  v_new_immutable := financehub_month_is_immutable(NEW."user_id", NEW."month_id");
  IF NOT v_old_immutable AND NOT v_new_immutable THEN RETURN NEW; END IF;

  -- Somente liquidação e estorno podem evoluir depois do mês. Todos os
  -- campos estruturais (inclusive user/month/date/value/vínculos) precisam
  -- permanecer idênticos, tanto na origem quanto no destino.
  v_old_struct := to_jsonb(OLD) - ARRAY[
    'paid_amount','paid_at','status','payment_method','reversed_at','reversed_amount',
    'residual_amount','residual_settled_at','carried_to_expense_id','updated_at'
  ];
  v_new_struct := to_jsonb(NEW) - ARRAY[
    'paid_amount','paid_at','status','payment_method','reversed_at','reversed_amount',
    'residual_amount','residual_settled_at','carried_to_expense_id','updated_at'
  ];
  IF v_old_struct IS DISTINCT FROM v_new_struct THEN
    RAISE EXCEPTION 'MONTH_IMMUTABLE'
      USING ERRCODE = 'P0001', DETAIL = 'Only settlement/reversal fields may change after the month elapsed';
  END IF;

  -- A primeira liquidação/estorno pode ser registrada depois do vencimento,
  -- mas uma data factual já persistida nunca pode ser reescrita ou apagada.
  IF OLD."paid_at" IS NOT NULL AND NEW."paid_at" IS DISTINCT FROM OLD."paid_at" THEN
    RAISE EXCEPTION 'PAID_AT_IMMUTABLE'
      USING ERRCODE = 'P0001', DETAIL = 'Recorded payment date cannot be rewritten';
  END IF;
  IF OLD."reversed_at" IS NOT NULL AND NEW."reversed_at" IS DISTINCT FROM OLD."reversed_at" THEN
    RAISE EXCEPTION 'REVERSAL_DATE_IMMUTABLE'
      USING ERRCODE = 'P0001', DETAIL = 'Recorded reversal date cannot be rewritten';
  END IF;
  IF NEW."paid_amount" < OLD."paid_amount"
     AND COALESCE(NEW."status"::TEXT, '') <> 'reversed' THEN
    RAISE EXCEPTION 'PAYMENT_AMOUNT_IMMUTABLE'
      USING ERRCODE = 'P0001', DETAIL = 'Paid amount cannot decrease outside a reversal';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION financehub_guard_goal_contribution_month()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_old_user BIGINT;
  v_new_user BIGINT;
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('financehub.allow_ledger_delete', true) = 'on' THEN
    RETURN OLD;
  END IF;

  IF TG_OP <> 'INSERT' THEN
    SELECT "user_id" INTO v_old_user FROM "goals" WHERE "id" = OLD."goal_id";
  END IF;
  IF TG_OP <> 'DELETE' THEN
    SELECT "user_id" INTO v_new_user FROM "goals" WHERE "id" = NEW."goal_id";
  END IF;

  IF (TG_OP <> 'INSERT' AND financehub_month_is_immutable(v_old_user, OLD."month_id"))
     OR (TG_OP <> 'DELETE' AND financehub_month_is_immutable(v_new_user, NEW."month_id")) THEN
    RAISE EXCEPTION 'MONTH_IMMUTABLE'
      USING ERRCODE = 'P0001', DETAIL = 'Goal movement belongs to a closed or elapsed month';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION financehub_guard_savings_date()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('financehub.allow_ledger_delete', true) = 'on' THEN
    RETURN OLD;
  END IF;

  IF (TG_OP <> 'INSERT' AND financehub_date_is_immutable(OLD."user_id", OLD."transaction_date"))
     OR (TG_OP <> 'DELETE' AND financehub_date_is_immutable(NEW."user_id", NEW."transaction_date")) THEN
    RAISE EXCEPTION 'MONTH_IMMUTABLE'
      USING ERRCODE = 'P0001', DETAIL = 'Savings movement belongs to a closed or elapsed month';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_income_month ON "incomes";
CREATE TRIGGER trg_guard_income_month
BEFORE INSERT OR UPDATE OR DELETE ON "incomes"
FOR EACH ROW EXECUTE FUNCTION financehub_guard_income_month();

DROP TRIGGER IF EXISTS trg_guard_expense_month ON "expenses";
CREATE TRIGGER trg_guard_expense_month
BEFORE INSERT OR UPDATE OR DELETE ON "expenses"
FOR EACH ROW EXECUTE FUNCTION financehub_guard_expense_month();

DROP TRIGGER IF EXISTS trg_guard_goal_contribution_month ON "goal_contributions";
CREATE TRIGGER trg_guard_goal_contribution_month
BEFORE INSERT OR UPDATE OR DELETE ON "goal_contributions"
FOR EACH ROW EXECUTE FUNCTION financehub_guard_goal_contribution_month();

DROP TRIGGER IF EXISTS trg_guard_savings_date ON "savings_transactions";
CREATE TRIGGER trg_guard_savings_date
BEFORE INSERT OR UPDATE OR DELETE ON "savings_transactions"
FOR EACH ROW EXECUTE FUNCTION financehub_guard_savings_date();

-- Auditoria mínima, sanitizada e ATÔMICA para o núcleo financeiro. O trigger
-- não copia valores/descrições: apenas registra que uma linha foi criada ou
-- alterada, dentro da mesma transação que efetuou a mudança.
CREATE OR REPLACE FUNCTION financehub_atomic_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_user BIGINT;
  v_entity_id BIGINT;
  v_card_id BIGINT;
  v_goal_id BIGINT;
BEGIN
  -- Exclusão explícita de conta/simulação remove o perfil inteiro. Registrar
  -- milhares de eventos filhos durante o cascade pode recriar linhas com FK
  -- para o usuário que está sendo apagado e bloquear a própria exclusão. A
  -- ação administrativa final é auditada separadamente pelo serviço.
  IF current_setting('financehub.allow_ledger_delete', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_entity_id := NEW."id";
  ELSE
    v_entity_id := OLD."id";
  END IF;

  IF TG_TABLE_NAME = 'card_invoices' THEN
    IF TG_OP = 'INSERT' THEN v_card_id := NEW."card_id"; ELSE v_card_id := OLD."card_id"; END IF;
    SELECT "user_id" INTO v_user FROM "cards" WHERE "id" = v_card_id;
  ELSIF TG_TABLE_NAME = 'goal_contributions' THEN
    IF TG_OP = 'INSERT' THEN v_goal_id := NEW."goal_id"; ELSE v_goal_id := OLD."goal_id"; END IF;
    SELECT "user_id" INTO v_user FROM "goals" WHERE "id" = v_goal_id;
  ELSE
    IF TG_OP = 'INSERT' THEN v_user := NEW."user_id"; ELSE v_user := OLD."user_id"; END IF;
  END IF;

  IF v_user IS NOT NULL THEN
    INSERT INTO "audit_log"(
      "user_id", "entity", "entity_id", "action", "old_value_json", "new_value_json", "created_at"
    ) VALUES (
      v_user,
      TG_TABLE_NAME,
      v_entity_id,
      lower(TG_OP) || '_atomic',
      CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN jsonb_build_object('source','database_trigger') ELSE NULL END,
      CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN jsonb_build_object('source','database_trigger') ELSE NULL END,
      CURRENT_TIMESTAMP
    );
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'incomes','expenses','savings_transactions','goal_contributions',
    'card_invoices','card_purchases','debts','months'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'trg_atomic_audit_' || table_name, table_name);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION financehub_atomic_audit()',
      'trg_atomic_audit_' || table_name,
      table_name
    );
  END LOOP;
END;
$$;
