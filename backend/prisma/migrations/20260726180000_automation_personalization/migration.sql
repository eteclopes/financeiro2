-- Personalização das automações: escolher quais grupos pagar e um piso de
-- saldo que a automação nunca ultrapassa. Aditiva e com valores padrão que
-- preservam o comportamento atual de quem já usa.
ALTER TABLE "automation_settings"
  ADD COLUMN "pay_debts"       BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "pay_bills"       BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "pay_invoices"    BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "minimum_balance" DECIMAL(12,2) NOT NULL DEFAULT 0;
