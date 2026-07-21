-- Distingue depósitos que saem do saldo disponível ('balance', o
-- comportamento de sempre até aqui — por isso é o default) de depósitos
-- que só registram dinheiro que já estava guardado fora do app
-- ('external', não deveria reduzir saldo nenhum).
CREATE TYPE "SavingsOrigin" AS ENUM ('balance', 'external');
ALTER TABLE "savings_transactions" ADD COLUMN "origin" "SavingsOrigin" NOT NULL DEFAULT 'balance';
