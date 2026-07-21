-- Migração incremental — Etapa 16 (Saúde Financeira + Alertas)
-- Rode isto SOMENTE se seu banco já existia antes desta entrega
-- (se você for criar o banco do zero, ignore este arquivo: o
-- database.sql atualizado na raiz do projeto já inclui estas colunas).

ALTER TABLE alerts
  ADD COLUMN resolved_at TIMESTAMP NULL AFTER read_at,
  ADD UNIQUE KEY uq_alerts_user_month_type (user_id, month_id, type);
