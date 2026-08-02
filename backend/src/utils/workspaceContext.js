const prisma = require('../config/prisma');
const AppError = require('./AppError');

const REAL_WORKSPACE_ID = 'real';
const WORKSPACE_HEADER = 'x-workspace-id';

function workspaceAwareRequest(req) {
  const path = String(req.originalUrl || req.url || '');
  return ![
    '/api/auth/',
    '/api/admin/',
    '/api/billing/',
    '/api/workspaces',
  ].some((prefix) => path.startsWith(prefix));
}

function samePlan(a, b) {
  return a.plan === b.plan
    && a.planSource === b.planSource
    && String(a.planGrantedAt || '') === String(b.planGrantedAt || '')
    && String(a.planExpiresAt || '') === String(b.planExpiresAt || '');
}

async function resolveWorkspaceIdentity(req, authenticatedUserId) {
  req.ownerUserId = authenticatedUserId;
  req.workspace = { id: REAL_WORKSPACE_ID, type: 'real', name: 'Financeiro real' };
  req.userId = authenticatedUserId;

  if (!workspaceAwareRequest(req)) return;

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
      owner: {
        select: {
          plan: true,
          planSource: true,
          planGrantedAt: true,
          planExpiresAt: true,
        },
      },
      profile: {
        select: {
          id: true,
          plan: true,
          planSource: true,
          planGrantedAt: true,
          planExpiresAt: true,
          isSimulationProfile: true,
        },
      },
    },
  });

  if (!workspace || !workspace.profile?.isSimulationProfile) {
    throw new AppError('Simulação não encontrada ou sem acesso.', 404, 'WORKSPACE_NOT_FOUND');
  }

  // O plano pertence à conta real. O perfil interno é mantido sincronizado
  // para que limites já existentes (cartões/recursos Pro) continuem usando as
  // mesmas regras sem dar privilégios extras à simulação.
  if (!samePlan(workspace.owner, workspace.profile)) {
    await prisma.user.update({
      where: { id: workspace.profileUserId },
      data: {
        plan: workspace.owner.plan,
        planSource: workspace.owner.planSource,
        planGrantedAt: workspace.owner.planGrantedAt,
        planExpiresAt: workspace.owner.planExpiresAt,
      },
    });
  }

  req.userId = workspace.profileUserId;
  req.workspace = {
    id: String(workspace.id),
    type: 'simulation',
    name: workspace.name,
  };
}

module.exports = {
  REAL_WORKSPACE_ID,
  WORKSPACE_HEADER,
  resolveWorkspaceIdentity,
};
