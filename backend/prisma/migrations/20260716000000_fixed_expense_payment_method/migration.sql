-- Forma de pagamento por despesa fixa recorrente. Default 'transfer' (Conta)
-- para as despesas já cadastradas antes desta funcionalidade existir —
-- preserva o comportamento atual delas (descontar direto do saldo) sem
-- exigir que o usuário edite cada uma manualmente.
ALTER TABLE "fixed_expense_templates" ADD COLUMN "payment_method" "PaymentMethod" NOT NULL DEFAULT 'transfer';

-- Cartão vinculado, só relevante quando payment_method = 'credit'. Sem
-- ON DELETE CASCADE de propósito: apagar um cartão não deve apagar
-- despesas fixas que apontam para ele silenciosamente — ver validação em
-- cards.service.deleteCard (bloqueia exclusão enquanto houver vínculo).
ALTER TABLE "fixed_expense_templates" ADD COLUMN "card_id" BIGINT;
ALTER TABLE "fixed_expense_templates"
  ADD CONSTRAINT "fixed_expense_templates_card_id_fkey"
  FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
