-- Caixinhas de reserva: organiza o saldo guardado sem alterar o caixa total.
CREATE TYPE "SavingsBucketKind" AS ENUM (
  'general',
  'emergency',
  'travel',
  'home',
  'education',
  'vehicle',
  'custom'
);

CREATE TABLE "savings_buckets" (
  "id" BIGSERIAL NOT NULL,
  "user_id" BIGINT NOT NULL,
  "kind" "SavingsBucketKind" NOT NULL DEFAULT 'general',
  "name" VARCHAR(120),
  "target_value" DECIMAL(12,2),
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "is_archived" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "savings_buckets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "savings_buckets_user_id_is_archived_idx"
  ON "savings_buckets" ("user_id", "is_archived");

-- Garante uma única caixinha padrão por usuário, inclusive em concorrência.
CREATE UNIQUE INDEX "savings_buckets_one_default_per_user_idx"
  ON "savings_buckets" ("user_id")
  WHERE "is_default" = true;

ALTER TABLE "savings_buckets"
  ADD CONSTRAINT "savings_buckets_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "savings_transactions"
  ADD COLUMN "bucket_id" BIGINT,
  ADD COLUMN "bucket_balance_after" DECIMAL(12,2),
  ADD COLUMN "transfer_id" VARCHAR(36);

-- Todo usuário existente recebe uma caixinha geral. O histórico anterior é
-- preservado nela 1:1; portanto nenhum valor financeiro é recalculado.
INSERT INTO "savings_buckets" (
  "user_id", "kind", "name", "target_value", "is_default", "is_archived"
)
SELECT "id", 'general', NULL, NULL, true, false
FROM "users";

UPDATE "savings_transactions" AS st
SET
  "bucket_id" = sb."id",
  "bucket_balance_after" = st."balance_after"
FROM "savings_buckets" AS sb
WHERE sb."user_id" = st."user_id"
  AND sb."is_default" = true;

-- Compatibilidade de rolling deploy: durante alguns instantes, a instância
-- anterior do backend pode continuar atendendo enquanto a nova é iniciada.
-- Ela ainda não envia bucket_id/bucket_balance_after. O trigger abaixo recebe
-- esses lançamentos na caixinha principal sem quebrar o serviço. A versão nova
-- sempre envia os dois campos e, portanto, passa pelo trigger sem alteração.
CREATE OR REPLACE FUNCTION "fill_savings_bucket_fields"()
RETURNS TRIGGER AS $$
DECLARE
  default_bucket_id BIGINT;
  previous_bucket_balance DECIMAL(12,2);
BEGIN
  IF NEW."bucket_id" IS NULL THEN
    INSERT INTO "savings_buckets" (
      "user_id", "kind", "name", "target_value", "is_default", "is_archived"
    ) VALUES (
      NEW."user_id", 'general', NULL, NULL, true, false
    )
    ON CONFLICT DO NOTHING;

    SELECT "id"
      INTO default_bucket_id
      FROM "savings_buckets"
     WHERE "user_id" = NEW."user_id"
       AND "is_default" = true
     LIMIT 1;

    NEW."bucket_id" := default_bucket_id;
  END IF;

  IF TG_OP = 'INSERT' AND NEW."bucket_balance_after" IS NULL THEN
    SELECT "bucket_balance_after"
      INTO previous_bucket_balance
      FROM "savings_transactions"
     WHERE "user_id" = NEW."user_id"
       AND "bucket_id" = NEW."bucket_id"
     ORDER BY "created_at" DESC, "id" DESC
     LIMIT 1;

    NEW."bucket_balance_after" := ROUND(
      COALESCE(previous_bucket_balance, 0)
      + CASE WHEN NEW."type" = 'deposit' THEN NEW."value" ELSE -NEW."value" END,
      2
    );
  ELSIF TG_OP = 'UPDATE'
    AND NEW."bucket_balance_after" IS NOT DISTINCT FROM OLD."bucket_balance_after"
    AND (
      NEW."value" IS DISTINCT FROM OLD."value"
      OR NEW."type" IS DISTINCT FROM OLD."type"
      OR NEW."bucket_id" IS DISTINCT FROM OLD."bucket_id"
    ) THEN
    SELECT "bucket_balance_after"
      INTO previous_bucket_balance
      FROM "savings_transactions"
     WHERE "user_id" = NEW."user_id"
       AND "bucket_id" = NEW."bucket_id"
       AND "id" <> OLD."id"
     ORDER BY "created_at" DESC, "id" DESC
     LIMIT 1;

    NEW."bucket_balance_after" := ROUND(
      COALESCE(previous_bucket_balance, 0)
      + CASE WHEN NEW."type" = 'deposit' THEN NEW."value" ELSE -NEW."value" END,
      2
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "savings_transactions_fill_bucket_fields"
BEFORE INSERT OR UPDATE ON "savings_transactions"
FOR EACH ROW
EXECUTE FUNCTION "fill_savings_bucket_fields"();

ALTER TABLE "savings_transactions"
  ALTER COLUMN "bucket_id" SET NOT NULL,
  ALTER COLUMN "bucket_balance_after" SET NOT NULL;

CREATE INDEX "savings_transactions_user_id_created_at_idx"
  ON "savings_transactions" ("user_id", "created_at");
CREATE INDEX "savings_transactions_bucket_id_created_at_idx"
  ON "savings_transactions" ("bucket_id", "created_at");
CREATE INDEX "savings_transactions_transfer_id_idx"
  ON "savings_transactions" ("transfer_id");

ALTER TABLE "savings_transactions"
  ADD CONSTRAINT "savings_transactions_bucket_id_fkey"
  FOREIGN KEY ("bucket_id") REFERENCES "savings_buckets"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
