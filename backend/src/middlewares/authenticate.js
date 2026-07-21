const AppError = require('../utils/AppError');
const { verifyAccessToken } = require('../utils/tokens');

/**
 * Toda rota privada do sistema passa por aqui. É a ÚNICA fonte de verdade
 * de "quem é o usuário logado" (req.userId) — nenhum controller deve
 * confiar em um user_id vindo do body/query, sempre usar req.userId.
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    throw new AppError('Token de acesso ausente.', 401, 'UNAUTHORIZED');
  }

  const token = header.slice('Bearer '.length);

  try {
    const payload = verifyAccessToken(token);
    req.userId = BigInt(payload.sub);
    next();
  } catch (err) {
    throw new AppError('Token de acesso inválido ou expirado.', 401, 'UNAUTHORIZED');
  }
}

module.exports = authenticate;
