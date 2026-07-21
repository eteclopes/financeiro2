-- Assinaturas recorrentes (Netflix, academia, etc.) com periodicidade
-- própria (mensal/anual/customizada), independente do ciclo mensal fixo
-- que fixed_expense_templates usa.
CREATE TYPE "SubscriptionPeriodicity" AS ENUM ('monthly', 'annual', 'custom');
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'paused', 'cancelled', 'completed');

-- Novo valor de ExpenseType para diferenciar despesa gerada por assinatura
-- de uma despesa fixa comum (mesmo espírito de 'card', que já existe).
ALTER TYPE "ExpenseType" ADD VALUE 'subscription';

CREATE TABLE "subscriptions" (
  "id" BIGSERIAL PRIMARY KEY,
  "user_id" BIGINT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "description" VARCHAR(160) NOT NULL,
  "category_id" BIGINT NOT NULL REFERENCES "categories"("id"),
  "value" DECIMAL(12,2) NOT NULL,
  "payment_method" "PaymentMethod" NOT NULL,
  "card_id" BIGINT REFERENCES "cards"("id") ON DELETE RESTRICT,
  "periodicity" "SubscriptionPeriodicity" NOT NULL DEFAULT 'monthly',
  "custom_interval_months" SMALLINT,
  "next_charge_date" DATE NOT NULL,
  "end_date" DATE,
  "status" "SubscriptionStatus" NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE INDEX "subscriptions_user_id_status_idx" ON "subscriptions"("user_id", "status");

ALTER TABLE "expenses" ADD COLUMN "subscription_id" BIGINT;
ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_subscription_id_fkey"
  FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
