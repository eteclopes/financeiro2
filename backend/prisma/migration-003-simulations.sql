-- Migração incremental — Módulo 4 (Simulador "E Se")
-- Rode isto SOMENTE se seu banco já existia antes desta entrega
-- (quem for criar o banco do zero usa o database.sql atualizado na raiz).

CREATE TABLE simulations (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id      BIGINT UNSIGNED NOT NULL,
  type         ENUM('pay_debt','anticipate_installments','save_monthly','reduce_category','cancel_subscription','increase_income') NOT NULL,
  name         VARCHAR(160) NOT NULL,
  input_json   JSON NOT NULL,
  months_ahead SMALLINT UNSIGNED NOT NULL DEFAULT 12,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_simulations_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  KEY idx_simulations_user (user_id)
) ENGINE=InnoDB;

CREATE TABLE simulation_results (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  simulation_id BIGINT UNSIGNED NOT NULL,
  month_index   SMALLINT UNSIGNED NOT NULL,
  month         TINYINT UNSIGNED NOT NULL,
  year          SMALLINT UNSIGNED NOT NULL,
  baseline_net  DECIMAL(12,2) NOT NULL,
  scenario_net  DECIMAL(12,2) NOT NULL,
  difference    DECIMAL(12,2) NOT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_simulation_results_simulation FOREIGN KEY (simulation_id) REFERENCES simulations(id) ON DELETE CASCADE,
  UNIQUE KEY uq_simulation_results_sim_index (simulation_id, month_index)
) ENGINE=InnoDB;
