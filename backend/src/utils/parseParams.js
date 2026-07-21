const AppError = require('./AppError');

/**
 * CORREÇÃO BUG 3: BigInt(undefined) e BigInt("") lançam TypeError —
 * resultando em HTTP 500 em vez de 422. Este helper centraliza a conversão
 * segura de query params de monthId (e qualquer BigInt de query) em todas
 * as 8 rotas que tinham o mesmo problema.
 */
function parseMonthId(query) {
  const raw = query.monthId;
  if (!raw) {
    throw new AppError('O parâmetro monthId é obrigatório.', 422, 'VALIDATION_ERROR');
  }
  try {
    return BigInt(raw);
  } catch {
    throw new AppError('monthId inválido.', 422, 'VALIDATION_ERROR');
  }
}

function parseBigIntParam(value, fieldName) {
  if (!value) throw new AppError(`${fieldName} é obrigatório.`, 422, 'VALIDATION_ERROR');
  try {
    return BigInt(value);
  } catch {
    throw new AppError(`${fieldName} inválido.`, 422, 'VALIDATION_ERROR');
  }
}

module.exports = { parseMonthId, parseBigIntParam };
