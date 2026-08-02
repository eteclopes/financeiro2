-- Ambientes de simulação isolados. Cada simulação usa um perfil financeiro
-- interno próprio, permitindo reutilizar todas as regras atuais sem misturar
-- qualquer lançamento com a conta real do proprietário.
CREATE TYPE "SimulationWorkspaceStatus" AS ENUM ('active', 'archived');

ALTER TABLE "users"
ADD COLUMN "is_simulation_profile" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "simulation_workspaces" (
  "id" BIGSERIAL NOT NULL,
  "owner_user_id" BIGINT NOT NULL,
  "profile_user_id" BIGINT NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "status" "SimulationWorkspaceStatus" NOT NULL DEFAULT 'active',
  "start_month" SMALLINT NOT NULL,
  "start_year" SMALLINT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "simulation_workspaces_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "simulation_workspaces_profile_user_id_key"
ON "simulation_workspaces"("profile_user_id");

CREATE UNIQUE INDEX "simulation_workspaces_owner_user_id_name_key"
ON "simulation_workspaces"("owner_user_id", "name");

CREATE INDEX "simulation_workspaces_owner_user_id_status_idx"
ON "simulation_workspaces"("owner_user_id", "status");

CREATE INDEX "users_is_simulation_profile_idx"
ON "users"("is_simulation_profile");

ALTER TABLE "simulation_workspaces"
ADD CONSTRAINT "simulation_workspaces_owner_user_id_fkey"
FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "simulation_workspaces"
ADD CONSTRAINT "simulation_workspaces_profile_user_id_fkey"
FOREIGN KEY ("profile_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
