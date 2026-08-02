const prisma = require('../config/prisma');
const AppError = require('./AppError');
const { setRequestFinancialContext } = require('./requestContext');
const { utcDateFromParts, getRealCalendarDateParts } = require('./dateTime');

const REAL_WORKSPACE_ID = 'real';
const WORKSPACE_HEADER = 'x-workspace-id';

function workspaceAwareRequest(req) {
  const path = String(req.originalUrl || req.url || '');
  return ![
    '/api/auth/',
    '/api/admin/',
    '/api/admin-auth/',
    '/api/billing/',
    '/api/workspaces',
  ].some((prefix) => path.startsWith(prefix));
}

async function resolveWorkspaceIdentity(req, authenticatedUserId) {
  req.ownerUserId = authenticatedUserId;
  req.workspace = { id: REAL_WORKSPACE_ID, type: 'real', name: 'Financeiro real' };
  req.userId = authenticatedUserId;
  req.workspaceAware = workspaceAwareRequest(req);

  const real = getRealCalendarDateParts();
  setRequestFinancialContext({
    financialDate: utcDateFromParts(real.year, real.month, real.day),
    workspaceType: 'real',
    workspaceId: REAL_WORKSPACE_ID,
  });

  if (!req.workspaceAware) return;

  const raw = String(req.get(WORKSPACE_HEADER) || '').trim();
  if (!raw || raw === REAL_WORKSPACE_ID) return;
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new AppError('Ambiente financeiro inválido.', 400, 'WORKSPACE_INVALID');
  }

  const workspace = await prisma.simulationWorkspace.findFirst({
    where: {
      id: BigInt(raw),
      ownerUserId: authenticatedUserId,
      status: 'active',
    },
    select: {
      id: true,
      name: true,
      profileUserId: true,
      currentDate: true,
      profile: {
        select: {
          id: true,
          isSimulationProfile: true,
        },
      },
    },
  });

  if (!workspace || !workspace.profile?.isSimulationProfile) {
    throw new AppError('Simulação não encontrada ou sem acesso.', 404, 'WORKSPACE_NOT_FOUND');
  }

  req.userId = workspace.profileUserId;
  req.workspace = {
    id: String(workspace.id),
    type: 'simulation',
    name: workspace.name,
    currentDate: workspace.currentDate,
  };
  setRequestFinancialContext({
    financialDate: workspace.currentDate,
    workspaceType: 'simulation',
    workspaceId: workspace.id,
  });
}

module.exports = {
  REAL_WORKSPACE_ID,
  WORKSPACE_HEADER,
  resolveWorkspaceIdentity,
};
