/**
 * Faixas oficiais de comprometimento da renda, conforme definido para o
 * Dashboard Avançado — reaproveitadas aqui para que o simulador de compras
 * recomende/não recomende com o mesmo critério que o dashboard exibe.
 */
function classifyCommitment(ratio) {
  if (ratio <= 0.4) return 'saudavel';
  if (ratio <= 0.6) return 'atencao';
  if (ratio <= 0.8) return 'risco';
  return 'critico';
}

module.exports = { classifyCommitment };
