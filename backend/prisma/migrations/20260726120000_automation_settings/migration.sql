-- Automação: uma linha de configuração por usuário. Tudo opcional/desligado.
CREATE TABLE "automation_settings" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "pay_dues_on_close" BOOLEAN NOT NULL DEFAULT false,
    "pay_dues_method" VARCHAR(10) NOT NULL DEFAULT 'debit',
    "save_leftover_on_close" BOOLEAN NOT NULL DEFAULT false,
    "save_leftover_type" VARCHAR(10) NOT NULL DEFAULT 'percent',
    "save_leftover_value" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "save_leftover_bucket_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "automation_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "automation_settings_user_id_key" ON "automation_settings"("user_id");

ALTER TABLE "automation_settings"
    ADD CONSTRAINT "automation_settings_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "automation_settings"
    ADD CONSTRAINT "automation_settings_save_leftover_bucket_id_fkey"
    FOREIGN KEY ("save_leftover_bucket_id") REFERENCES "savings_buckets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
