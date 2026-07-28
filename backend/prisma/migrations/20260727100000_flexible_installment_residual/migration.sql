-- Pagamento flexível de parcela de dívida.
--
-- Antes: pagar menos que a parcela deixava o status 'partial' e a parcela
-- continuava aparecendo como pendência/atraso do mês. O usuário cumpria o
-- combinado e o sistema seguia cobrando.
--
-- Agora: a obrigação do mês é encerrada ('flex_paid') e o que faltou vira um
-- SALDO RESIDUAL registrado na própria parcela, somado à parcela seguinte e
-- quitável depois, sem nunca reabrir a parcela anterior.
--
-- Migration ADITIVA: nenhuma coluna é removida, nenhum dado é alterado.

ALTER TYPE "ExpenseStatus" ADD VALUE IF NOT EXISTS 'flex_paid';

ALTER TABLE "expenses"
  ADD COLUMN IF NOT EXISTS "residual_amount"      DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "residual_settled_at"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "carried_to_expense_id" BIGINT;

-- Consulta usada para listar residuais em aberto de uma dívida.
CREATE INDEX IF NOT EXISTS "expenses_debt_residual_idx"
  ON "expenses" ("debt_id") WHERE "residual_amount" > 0;
