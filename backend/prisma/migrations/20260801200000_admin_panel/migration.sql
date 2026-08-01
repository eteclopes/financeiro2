ALTER TYPE "PlanSource" ADD VALUE IF NOT EXISTS 'manual_admin';

-- Painel administrativo: papel explícito e protegido no servidor.
CREATE TYPE "UserRole" AS ENUM ('user', 'admin');

ALTER TABLE "users"
ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'user';

CREATE INDEX "users_role_idx" ON "users"("role");
