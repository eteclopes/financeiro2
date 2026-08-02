const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { verifyAccessToken, AUTH_CLIENTS } = require('../utils/tokens');
const { resolveWorkspaceIdentity } = require('../utils/workspaceContext');
const { ensureCalendarMonthsClosed } = require('../modules/closing/calendarClosing.service');
const { setRequestFinancialContext, getRequestTimeZone } = require('../utils/requestContext');
const prisma = require('../config/prisma');

function readBearer(req, client) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw new AppError('Token de acesso ausente.', 401, 'UNAUTHORIZED');
  }
  const token = header.slice('Bearer '.length).trim();
  if (!token || token.length > 4096) {
    throw new AppError('Token de acesso inválido ou expirado.', 401, 'UNAUTHORIZED');
  }
  const payload = verifyAccessToken(token, client);
  if (payload.typ !== 'access' || typeof payload.sub !== 'string' || !/^[1-9]\d*$/.test(payload.sub)) {
    throw new Error('invalid token subject');
  }
  return payload;
}

const authenticate = asyncHandler(async (req, _res, next) => {
  let payload;
  try {
    payload = readBearer(req, AUTH_CLIENTS.USER);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('Token de acesso inválido ou expirado.', 401, 'UNAUTHORIZED');
  }

  // Falhas de workspace, banco ou fechamento NÃO são falhas de autenticação.
  // Mantê-las fora do bloco acima preserva o status correto (409/503/500) e
  // evita deslogar o usuário quando uma transação financeira temporariamente
  // falha.
  setRequestFinancialContext({ authClient: AUTH_CLIENTS.USER });
  const authenticatedUserId = BigInt(payload.sub);
  const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  const requestTimeZone = getRequestTimeZone();
  // Leituras permanecem puras. O fuso é persistido apenas antes de uma mutação,
  // pois os guards do PostgreSQL precisam usar o mesmo calendário civil da
  // operação que está prestes a alterar o ledger.
  if (mutation) {
    await prisma.user.updateMany({
      where: { id: authenticatedUserId, isSimulationProfile: false, timezone: { not: requestTimeZone } },
      data: { timezone: requestTimeZone },
    });
  }
  await resolveWorkspaceIdentity(req, authenticatedUserId);

  // Toda mutação financeira real sincroniza o calendário no servidor antes
  // de chegar ao serviço. Assim uma aba antiga não consegue gravar no mês
  // anterior depois da virada. Os guards do PostgreSQL formam a segunda
  // barreira contra concorrência entre fechamento e gravação.
  const isExplicitCalendarSync = String(req.originalUrl || '').split('?')[0] === '/api/months/sync-calendar';
  if (mutation && req.workspaceAware && req.workspace?.type === 'real' && !isExplicitCalendarSync) {
    await ensureCalendarMonthsClosed(req.userId);
  }
  next();
});

const authenticateAdmin = asyncHandler(async (req, _res, next) => {
  let payload;
  try {
    payload = readBearer(req, AUTH_CLIENTS.ADMIN);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('Sessão administrativa inválida ou expirada.', 401, 'UNAUTHORIZED');
  }
  setRequestFinancialContext({ authClient: AUTH_CLIENTS.ADMIN });
  req.userId = BigInt(payload.sub);
  req.ownerUserId = req.userId;
  req.workspace = null;
  req.workspaceAware = false;
  next();
});

module.exports = authenticate;
module.exports.authenticateAdmin = authenticateAdmin;
