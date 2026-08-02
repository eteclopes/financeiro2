const prisma = require('../../config/prisma');
const env = require('../../config/env');
const AppError = require('../../utils/AppError');
const { recordAuditLog } = require('../auditLog/auditLog.service');
const { deleteFinancialProfiles } = require('../_shared/deleteFinancialProfile');

const DAY_MS = 24 * 60 * 60 * 1000;

function pageMeta(total, page, pageSize) {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

function activeProWhere(now = new Date()) {
  return {
    isSimulationProfile: false,
    plan: 'pro',
    OR: [{ planExpiresAt: null }, { planExpiresAt: { gt: now } }],
  };
}

function dateKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function buildDailySeries(rows, days = 30) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const counts = new Map();
  for (const row of rows) {
    const key = dateKey(row.createdAt);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(today.getTime() - (days - index - 1) * DAY_MS);
    const key = dateKey(date);
    return { date: key, value: counts.get(key) || 0 };
  });
}

async function overview() {
  const now = new Date();
  const since30Days = new Date(now.getTime() - 29 * DAY_MS);
  since30Days.setUTCHours(0, 0, 0, 0);

  const [
    totalUsers,
    proUsers,
    adminUsers,
    newUsers30Days,
    paidRevenue,
    paidPurchases,
    pendingPurchases,
    openMonths,
    recentUsers,
    signupRows,
  ] = await Promise.all([
    prisma.user.count({ where: { isSimulationProfile: false } }),
    prisma.user.count({ where: activeProWhere(now) }),
    prisma.user.count({ where: { role: 'admin', isSimulationProfile: false } }),
    prisma.user.count({ where: { createdAt: { gte: since30Days }, isSimulationProfile: false } }),
    prisma.billingPurchase.aggregate({
      where: { status: 'paid' },
      _sum: { amountTotal: true },
    }),
    prisma.billingPurchase.count({ where: { status: 'paid' } }),
    prisma.billingPurchase.count({ where: { status: 'pending' } }),
    prisma.month.count({ where: { status: 'open', user: { isSimulationProfile: false } } }),
    prisma.user.findMany({
      where: { isSimulationProfile: false },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: { id: true, name: true, email: true, role: true, plan: true, createdAt: true },
    }),
    prisma.user.findMany({
      where: { createdAt: { gte: since30Days }, isSimulationProfile: false },
      select: { createdAt: true },
    }),
  ]);

  return {
    metrics: {
      totalUsers,
      proUsers,
      basicUsers: Math.max(0, totalUsers - proUsers),
      adminUsers,
      newUsers30Days,
      paidPurchases,
      pendingPurchases,
      revenueCents: paidRevenue._sum.amountTotal || 0,
      openMonths,
    },
    signups: buildDailySeries(signupRows),
    recentUsers,
  };
}

async function listUsers({ page, pageSize, search, plan, role }) {
  const where = {
    isSimulationProfile: false,
    ...(plan ? { plan } : {}),
    ...(role ? { role } : {}),
    ...(search ? {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ],
    } : {}),
  };

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        plan: true,
        planSource: true,
        planGrantedAt: true,
        planExpiresAt: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            months: true,
            cards: true,
            debts: true,
            goals: true,
            billingPurchases: true,
          },
        },
      },
    }),
  ]);

  return { users, pagination: pageMeta(total, page, pageSize) };
}

async function getUser(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      isSimulationProfile: true,
      name: true,
      email: true,
      role: true,
      plan: true,
      planSource: true,
      planGrantedAt: true,
      planExpiresAt: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          months: true,
          incomeTemplates: true,
          incomes: true,
          fixedExpenseTemplates: true,
          expenses: true,
          debts: true,
          cards: true,
          goals: true,
          savingsBuckets: true,
          billingPurchases: true,
          refreshTokens: true,
        },
      },
      billingPurchases: {
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          status: true,
          amountTotal: true,
          currency: true,
          paidAt: true,
          refundedAt: true,
          createdAt: true,
        },
      },
      auditLogs: {
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, entity: true, entityId: true, action: true, createdAt: true },
      },
    },
  });
  if (!user || user.isSimulationProfile) throw new AppError('Usuário não encontrado.', 404, 'USER_NOT_FOUND');
  return user;
}

async function updateUserPlan(adminId, userId, plan) {
  const current = await prisma.user.findUnique({ where: { id: userId } });
  if (!current || current.isSimulationProfile) throw new AppError('Usuário não encontrado.', 404, 'USER_NOT_FOUND');
  if (plan === 'basic' && current.planSource === 'stripe_lifetime') {
    throw new AppError(
      'Uma compra vitalícia paga não pode ser removida manualmente. Registre o reembolso no Stripe.',
      409,
      'PAID_PLAN_REVOCATION_BLOCKED'
    );
  }

  const data = plan === 'pro'
    ? { plan: 'pro', planSource: 'manual_admin', planGrantedAt: new Date(), planExpiresAt: null }
    : { plan: 'basic', planSource: 'basic', planGrantedAt: null, planExpiresAt: null };

  const updated = await prisma.user.update({
    where: { id: userId },
    data,
    select: {
      id: true, name: true, email: true, role: true, plan: true,
      planSource: true, planGrantedAt: true, planExpiresAt: true,
    },
  });
  await recordAuditLog(adminId, 'admin_user', userId, `set_plan_${plan}`, {
    oldValue: { plan: current.plan, planSource: current.planSource },
    newValue: { plan, planSource: data.planSource },
  });
  return updated;
}

async function updateUserRole(adminId, userId, role) {
  const current = await prisma.user.findUnique({ where: { id: userId } });
  if (!current || current.isSimulationProfile) throw new AppError('Usuário não encontrado.', 404, 'USER_NOT_FOUND');
  if (adminId === userId && role !== 'admin') {
    throw new AppError('Você não pode remover seu próprio acesso administrativo.', 409, 'SELF_DEMOTION_BLOCKED');
  }
  if (current.role === 'admin' && role === 'user') {
    const adminCount = await prisma.user.count({ where: { role: 'admin', isSimulationProfile: false } });
    if (adminCount <= 1) {
      throw new AppError('O sistema precisa manter pelo menos um administrador.', 409, 'LAST_ADMIN_BLOCKED');
    }
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { role },
    select: { id: true, name: true, email: true, role: true, plan: true },
  });
  await recordAuditLog(adminId, 'admin_user', userId, `set_role_${role}`, {
    oldValue: { role: current.role },
    newValue: { role },
  });
  return updated;
}

async function revokeUserSessions(adminId, userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, isSimulationProfile: true } });
  if (!user || user.isSimulationProfile) throw new AppError('Usuário não encontrado.', 404, 'USER_NOT_FOUND');
  const result = await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await recordAuditLog(adminId, 'admin_user', userId, 'revoke_sessions', {
    newValue: { sessionState: 'revoked' },
  });
  return { revokedSessions: result.count };
}

async function deleteUser(adminId, userId) {
  if (String(adminId) === String(userId)) {
    throw new AppError(
      'Você não pode excluir a própria conta administrativa.',
      409,
      'SELF_DELETE_BLOCKED'
    );
  }

  const current = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, plan: true, planSource: true, isSimulationProfile: true },
  });
  if (!current || current.isSimulationProfile) throw new AppError('Usuário não encontrado.', 404, 'USER_NOT_FOUND');

  if (current.role === 'admin') {
    const adminCount = await prisma.user.count({ where: { role: 'admin', isSimulationProfile: false } });
    if (adminCount <= 1) {
      throw new AppError(
        'O sistema precisa manter pelo menos um administrador.',
        409,
        'LAST_ADMIN_DELETE_BLOCKED'
      );
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      const simulations = await tx.simulationWorkspace.findMany({
        where: { ownerUserId: userId },
        select: { id: true, profileUserId: true },
      });

      // Remove primeiro os vínculos de ambiente e depois todos os perfis em
      // lote. A versão anterior executava ~10 deleteMany por simulação e
      // mantinha a transação aberta por tempo demais (risco de P2028).
      if (simulations.length > 0) {
        await tx.simulationWorkspace.deleteMany({ where: { ownerUserId: userId } });
      }
      await deleteFinancialProfiles(
        [...simulations.map((simulation) => simulation.profileUserId), userId],
        tx
      );
    }, { maxWait: 10_000, timeout: 45_000 });
  } catch (error) {
    if (error?.code === 'P2025') {
      throw new AppError('Usuário não encontrado.', 404, 'USER_NOT_FOUND');
    }
    if (error?.code === 'P2003') {
      throw new AppError(
        'A conta possui dados vinculados que impediram a exclusão. Atualize o backend e tente novamente.',
        409,
        'USER_DELETE_RELATION_CONFLICT'
      );
    }
    throw error;
  }

  await recordAuditLog(adminId, 'admin_user', userId, 'delete_user', {
    oldValue: {
      role: current.role,
      plan: current.plan,
      planSource: current.planSource,
      accountState: 'active',
    },
    newValue: { accountState: 'deleted' },
  });
}

async function listBilling({ page, pageSize, search, status }) {
  const where = {
    ...(status ? { status } : {}),
    ...(search ? {
      user: {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      },
    } : {}),
  };
  const [total, purchases] = await Promise.all([
    prisma.billingPurchase.count({ where }),
    prisma.billingPurchase.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        status: true,
        amountTotal: true,
        currency: true,
        checkoutSessionId: true,
        paymentIntentId: true,
        paidAt: true,
        refundedAt: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
    }),
  ]);
  return { purchases, pagination: pageMeta(total, page, pageSize) };
}

async function listAudit({ page, pageSize, search, entity, action }) {
  const where = {
    ...(entity ? { entity } : {}),
    ...(action ? { action } : {}),
    ...(search ? {
      OR: [
        { entity: { contains: search, mode: 'insensitive' } },
        { action: { contains: search, mode: 'insensitive' } },
        { user: { name: { contains: search, mode: 'insensitive' } } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
      ],
    } : {}),
  };
  const [total, logs] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        entity: true,
        entityId: true,
        action: true,
        oldValueJson: true,
        newValueJson: true,
        createdAt: true,
        user: {
          select: {
            id: true, name: true, email: true, role: true, isSimulationProfile: true,
            simulationWorkspaceProfile: {
              select: { id: true, name: true, owner: { select: { id: true, name: true, email: true } } },
            },
          },
        },
      },
    }),
  ]);
  return { logs, pagination: pageMeta(total, page, pageSize) };
}

async function systemStatus() {
  const startedAt = new Date(Date.now() - process.uptime() * 1000);
  const dbStarted = Date.now();
  await prisma.$queryRaw`SELECT 1`;
  return {
    api: {
      status: 'ok',
      environment: env.NODE_ENV,
      uptimeSeconds: Math.floor(process.uptime()),
      startedAt,
      nodeVersion: process.version,
    },
    database: { status: 'ok', responseTimeMs: Date.now() - dbStarted },
    integrations: {
      stripeConfigured: Boolean(
        env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET && env.STRIPE_PRO_LIFETIME_PRICE_ID
      ),
      smtpConfigured: Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS),
    },
  };
}

module.exports = {
  overview,
  listUsers,
  getUser,
  updateUserPlan,
  updateUserRole,
  revokeUserSessions,
  deleteUser,
  listBilling,
  listAudit,
  systemStatus,
};
