const AppError = require('../utils/AppError');
const { verifyAccessToken } = require('../utils/tokens');

function authenticate(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    throw new AppError('Token de acesso ausente.', 401, 'UNAUTHORIZED');
  }

  const token = header.slice('Bearer '.length).trim();
  if (!token || token.length > 4096) {
    throw new AppError('Token de acesso inválido ou expirado.', 401, 'UNAUTHORIZED');
  }

  try {
    const payload = verifyAccessToken(token);
    if (payload.typ !== 'access' || typeof payload.sub !== 'string' || !/^[1-9]\d*$/.test(payload.sub)) {
      throw new Error('invalid token subject');
    }
    req.userId = BigInt(payload.sub);
    next();
  } catch {
    throw new AppError('Token de acesso inválido ou expirado.', 401, 'UNAUTHORIZED');
  }
}

module.exports = authenticate;
