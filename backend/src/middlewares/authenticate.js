const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { verifyAccessToken } = require('../utils/tokens');
const { resolveWorkspaceIdentity } = require('../utils/workspaceContext');

module.exports = asyncHandler(async (req, _res, next) => {
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
    await resolveWorkspaceIdentity(req, BigInt(payload.sub));
    next();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('Token de acesso inválido ou expirado.', 401, 'UNAUTHORIZED');
  }
});
