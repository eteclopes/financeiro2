-- Infraestrutura de planos e cobrança vitalícia via Stripe.
-- O plano Básico continua completo; recursos avançados são liberados por plan='pro'.
CREATE TYPE "PlanTier" AS ENUM ('basic', 'pro');
CREATE TYPE "PlanSource" AS ENUM ('basic', 'stripe_lifetime', 'manual_test');
CREATE TYPE "BillingPurchaseStatus" AS ENUM ('pending', 'paid', 'failed', 'expired', 'refunded');

ALTER TABLE "users"
  ADD COLUMN "plan" "PlanTier" NOT NULL DEFAULT 'basic',
  ADD COLUMN "plan_source" "PlanSource" NOT NULL DEFAULT 'basic',
  ADD COLUMN "plan_granted_at" TIMESTAMP(3),
  ADD COLUMN "plan_expires_at" TIMESTAMP(3),
  ADD COLUMN "stripe_customer_id" VARCHAR(255);

CREATE UNIQUE INDEX "users_stripe_customer_id_key" ON "users"("stripe_customer_id");

CREATE TABLE "dashboard_preferences" (
  "user_id" BIGINT NOT NULL,
  "show_summary_chart" BOOLEAN NOT NULL DEFAULT true,
  "show_alerts" BOOLEAN NOT NULL DEFAULT true,
  "show_recommendations" BOOLEAN NOT NULL DEFAULT true,
  "show_cards" BOOLEAN NOT NULL DEFAULT true,
  "show_projections" BOOLEAN NOT NULL DEFAULT true,
  "show_category_chart" BOOLEAN NOT NULL DEFAULT true,
  "show_goals" BOOLEAN NOT NULL DEFAULT true,
  "summary_chart" VARCHAR(20) NOT NULL DEFAULT 'bars',
  "projection_view" VARCHAR(20) NOT NULL DEFAULT 'area',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "dashboard_preferences_pkey" PRIMARY KEY ("user_id")
);
ALTER TABLE "dashboard_preferences"
  ADD CONSTRAINT "dashboard_preferences_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "billing_purchases" (
  "id" BIGSERIAL NOT NULL,
  "user_id" BIGINT NOT NULL,
  "checkout_session_id" VARCHAR(255) NOT NULL,
  "payment_intent_id" VARCHAR(255),
  "customer_id" VARCHAR(255),
  "price_id" VARCHAR(255) NOT NULL,
  "amount_total" INTEGER,
  "currency" VARCHAR(12),
  "status" "BillingPurchaseStatus" NOT NULL DEFAULT 'pending',
  "paid_at" TIMESTAMP(3),
  "refunded_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "billing_purchases_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "billing_purchases_checkout_session_id_key" ON "billing_purchases"("checkout_session_id");
CREATE UNIQUE INDEX "billing_purchases_payment_intent_id_key" ON "billing_purchases"("payment_intent_id");
CREATE INDEX "billing_purchases_user_id_status_idx" ON "billing_purchases"("user_id", "status");
ALTER TABLE "billing_purchases"
  ADD CONSTRAINT "billing_purchases_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "stripe_events" (
  "id" BIGSERIAL NOT NULL,
  "event_id" VARCHAR(255) NOT NULL,
  "type" VARCHAR(120) NOT NULL,
  "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stripe_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "stripe_events_event_id_key" ON "stripe_events"("event_id");
