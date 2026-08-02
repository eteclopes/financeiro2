const { randomUUID, randomBytes } = require('node:crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../../config/prisma');
const AppError = require('../../utils/AppError');
const { buildEntitlements } = require('../plans/plans.service');
const { deleteFinancialProfile } = require('../_shared/deleteFinancialProfile');
const { generateNextMonthEntries } = require('../closing/closing.service');
const { remainingInstallmentsFor } = require('../debts/debts.service');
const { recordAuditLog } = require('../auditLog/auditLog.service');

const BASIC_SIMULATION_LIMIT = 1;
const PRO_SIMULATION_LIMIT = 10;

function publicWorkspace(workspace) {
  return {
    id: String(workspace.id),
    type: 'simulation',
    name: workspace.name,
    status: workspace.status,
    startMonth: workspace.startMonth,
    startYear: workspace.startYear,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  };
}

async function listWorkspaces(ownerUserId) {
  const workspaces = await prisma.simulationWorkspace.findMany({
    where: { ownerUserId, status: 'active' },
    orderBy: { createdAt: 'asc' },
  });
  return {
    real: { id: 'real', type: 'real', name: 'Financeiro real' },
    simulations: workspaces.map(publicWorkspace),
  };
}

async function cloneSetup(tx, ownerUserId, profileUserId) {
  const [categories, cards, incomeTemplates, fixedTemplates, debts] = await Promise.all([
    tx.category.findMany({ where: { userId: ownerUserId } }),
    tx.card.findMany({ where: { userId: ownerUserId } }),
    tx.incomeTemplate.findMany({ where: { userId: ownerUserId, active: true } }),
    tx.fixedExpenseTemplate.findMany({ where: { userId: ownerUserId, active: true } }),
    tx.debt.findMany({ where: { userId: ownerUserId, status: 'active' } }),
  ]);

  const categoryMap = new Map();
  for (const category of categories) {
    const cloned = await tx.category.create({
      data: {
        userId: profileUserId,
        name: category.name,
        type: category.type,
        isDefault: false,
        monthlyLimit: category.monthlyLimit,
      },
    });
    categoryMap.set(String(category.id), cloned.id);
  }

  const mapCategory = (id) => categoryMap.get(String(id)) || id;
  const cardMap = new Map();
  for (const card of cards) {
    const cloned = await tx.card.create({
      data: {
        userId: profileUserId,
        name: card.name,
        color: card.color,
        limitValue: card.limitValue,
        closingDay: card.closingDay,
        dueDay: card.dueDay,
        active: card.active,
      },
    });
    cardMap.set(String(card.id), cloned.id);
  }

  for (const template of incomeTemplates) {
    await tx.incomeTemplate.create({
      data: {
        userId: profileUserId,
        description: template.description,
        value: template.value,
        categoryId: mapCategory(template.categoryId),
        paymentMethod: template.paymentMethod,
        incomeDay: template.incomeDay,
        active: template.active,
      },
    });
  }

  for (const template of fixedTemplates) {
    await tx.fixedExpenseTemplate.create({
      data: {
        userId: profileUserId,
        description: template.description,
        categoryId: mapCategory(template.categoryId),
        value: template.value,
        dueDay: template.dueDay,
        paymentMethod: template.paymentMethod,
        cardId: template.cardId ? cardMap.get(String(template.cardId)) || null : null,
        active: template.active,
      },
    });
  }

  for (const debt of debts) {
    await tx.debt.create({
      data: {
        userId: profileUserId,
        description: debt.description,
        categoryId: mapCategory(debt.categoryId),
        // A simulação começa no saldo devedor atual, sem fingir que as
        // parcelas já pagas no financeiro real aconteceram dentro do cenário.
        totalValue: debt.remainingBalance,
        installmentsCount: Math.max(1, remainingInstallmentsFor(debt)),
        installmentValue: debt.installmentValue,
        flexiblePayment: debt.flexiblePayment,
        dueDay: debt.dueDay,
        status: debt.status,
        remainingBalance: debt.remainingBalance,
        pendingCarryOver: debt.pendingCarryOver,
      },
    });
  }
}

async function createWorkspace(ownerUserId, input) {
  const owner = await prisma.user.findFirst({
    where: { id: ownerUserId, isSimulationProfile: false },
    select: {
      id: true,
      name: true,
      plan: true,
      planSource: true,
      planGrantedAt: true,
      planExpiresAt: true,
    },
  });
  if (!owner) throw new AppError('Usuário não encontrado.', 404, 'USER_NOT_FOUND');

  const entitlements = buildEntitlements(owner);
  const limit = entitlements.isPro ? PRO_SIMULATION_LIMIT : BASIC_SIMULATION_LIMIT;
  const count = await prisma.simulationWorkspace.count({
    where: { ownerUserId, status: 'active' },
  });
  if (count >= limit) {
    throw new AppError(
      entitlements.isPro
        ? `O limite de ${PRO_SIMULATION_LIMIT} simulações foi atingido.`
        : 'O Plano Básico permite uma simulação ativa. O Plano Pro permite até 10.',
      409,
      'SIMULATION_LIMIT_REACHED',
      { limit }
    );
  }

  const passwordHash = await bcrypt.hash(randomBytes(48).toString('hex'), 10);
  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      const profile = await tx.user.create({
        data: {
          name: `Simulação · ${input.name}`,
          email: `simulation-${ownerUserId}-${randomUUID()}@internal.financehub.invalid`,
          passwordHash,
          role: 'user',
          plan: owner.plan,
          planSource: owner.planSource,
          planGrantedAt: owner.planGrantedAt,
          planExpiresAt: owner.planExpiresAt,
          isSimulationProfile: true,
        },
      });

      const workspace = await tx.simulationWorkspace.create({
        data: {
          ownerUserId,
          profileUserId: profile.id,
          name: input.name,
          startMonth: input.startMonth,
          startYear: input.startYear,
        },
      });

      const month = await tx.month.create({
        data: {
          userId: profile.id,
          month: input.startMonth,
          year: input.startYear,
          status: 'open',
        },
      });

      if (input.copySetup) {
        await cloneSetup(tx, ownerUserId, profile.id);
        await generateNextMonthEntries(
          tx,
          profile.id,
          null,
          month,
          { month: input.startMonth, year: input.startYear }
        );
      }

      return workspace;
    }, { maxWait: 10_000, timeout: 25_000 });
  } catch (error) {
    if (error?.code === 'P2002') {
      throw new AppError('Já existe uma simulação com esse nome.', 409, 'WORKSPACE_NAME_IN_USE');
    }
    throw error;
  }

  await recordAuditLog(ownerUserId, 'simulation_workspace', created.id, 'create', {
    newValue: { name: created.name, copySetup: input.copySetup },
  });
  return publicWorkspace(created);
}

async function renameWorkspace(ownerUserId, workspaceId, name) {
  const current = await prisma.simulationWorkspace.findFirst({
    where: { id: workspaceId, ownerUserId, status: 'active' },
  });
  if (!current) throw new AppError('Simulação não encontrada.', 404, 'WORKSPACE_NOT_FOUND');

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const workspace = await tx.simulationWorkspace.update({
        where: { id: current.id },
        data: { name },
      });
      await tx.user.update({
        where: { id: current.profileUserId },
        data: { name: `Simulação · ${name}` },
      });
      return workspace;
    });
    await recordAuditLog(ownerUserId, 'simulation_workspace', workspaceId, 'rename', {
      oldValue: { name: current.name },
      newValue: { name },
    });
    return publicWorkspace(updated);
  } catch (error) {
    if (error?.code === 'P2002') {
      throw new AppError('Já existe uma simulação com esse nome.', 409, 'WORKSPACE_NAME_IN_USE');
    }
    throw error;
  }
}

async function deleteWorkspace(ownerUserId, workspaceId) {
  const workspace = await prisma.simulationWorkspace.findFirst({
    where: { id: workspaceId, ownerUserId },
  });
  if (!workspace) throw new AppError('Simulação não encontrada.', 404, 'WORKSPACE_NOT_FOUND');

  await prisma.$transaction(async (tx) => {
    await tx.simulationWorkspace.delete({ where: { id: workspace.id } });
    await deleteFinancialProfile(workspace.profileUserId, tx);
  }, { maxWait: 10_000, timeout: 25_000 });

  await recordAuditLog(ownerUserId, 'simulation_workspace', workspaceId, 'delete', {
    oldValue: { name: workspace.name },
  });
}

module.exports = {
  BASIC_SIMULATION_LIMIT,
  PRO_SIMULATION_LIMIT,
  listWorkspaces,
  createWorkspace,
  renameWorkspace,
  deleteWorkspace,
};
