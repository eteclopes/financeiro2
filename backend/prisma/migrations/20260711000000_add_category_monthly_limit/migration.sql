-- Adiciona orçamento mensal opcional por categoria (só relevante para categorias de despesa)
ALTER TABLE "categories" ADD COLUMN "monthly_limit" DECIMAL(12,2);
