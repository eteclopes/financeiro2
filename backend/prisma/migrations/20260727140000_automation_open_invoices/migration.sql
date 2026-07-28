-- Permite que a automação adiante faturas ainda não fechadas, por escolha
-- explícita do usuário. Padrão desligado (comportamento atual preservado).
ALTER TABLE "automation_settings"
  ADD COLUMN IF NOT EXISTS "pay_open_invoices" BOOLEAN NOT NULL DEFAULT false;
