const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../../config/prisma');
const env = require('../../config/env');
const AppError = require('../../utils/AppError');
const { recordAuditLog } = require('../auditLog/auditLog.service');
const { isMailConfigured, sendPasswordResetEmail } = require('../../utils/mailer');
const { buildEntitlements } = require('../plans/plans.service');
const {
  AUTH_CLIENTS,
  hashToken,
  generateOpaqueToken,
  signAccessToken,
  refreshTokenExpiryDate,
  passwordResetExpiryDate,
} = require('../../utils/tokens');

const BCRYPT_ROUNDS = 12;
const DUMMY_PASSWORD_HASH = '$2a$12$RXUW.qmEXBzInhTZlg2mM.VsSzXz7.mx2Ym7fdqSQc5iXHat1EaKC';

function publicUser(user) {
  const entitlements = buildEntitlements(user);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role || 'user',
    createdAt: user.createdAt,
    plan: entitlements.plan,
    isPro: entitlements.isPro,
    planSource: entitlements.source,
    planGrantedAt: entitlements.grantedAt,
    planExpiresAt: entitlements.expiresAt,
    entitlements,
  };
}

function pruneExpiredTokens() {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  prisma.refreshToken.deleteMany({
    where: { OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: cutoff } }] },
  }).catch(() => {});
}

function pruneExpiredPasswordResets() {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  prisma.passwordReset.deleteMany({
    where: { OR: [{ expiresAt: { lt: new Date() } }, { usedAt: { lt: cutoff } }] },
  }).catch(() => {});
}

async function issueSession(userId, {
  clientType = AUTH_CLIENTS.USER,
  client = prisma,
  familyId = null,
} = {}) {
  const accessToken = signAccessToken(userId, clientType);
  const rawRefreshToken = generateOpaqueToken();
  await client.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(rawRefreshToken),
      familyId: familyId || randomUUID(),
      client: clientType,
      expiresAt: refreshTokenExpiryDate(),
    },
  });
  if (client === prisma && Math.random() < 0.02) {
    pruneExpiredTokens();
    pruneExpiredPasswordResets();
  }
  return { accessToken, refreshToken: rawRefreshToken };
}

async function register({ name, email, password }) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new AppError('Este e-mail já está cadastrado.', 409, 'EMAIL_IN_USE');
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  let user;
  try {
    user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({ data: { name, email, passwordHash } });
      await tx.savingsBucket.create({
        data: { userId: created.id, kind: 'general', isDefault: true },
      });
      return created;
    });
  } catch (error) {
    if (error?.code === 'P2002') {
      throw new AppError('Este e-mail já está cadastrado.', 409, 'EMAIL_IN_USE');
    }
    throw error;
  }
  await recordAuditLog(user.id, 'user', user.id, 'register', { newValue: { name, email } });
  const session = await issueSession(user.id, { clientType: AUTH_CLIENTS.USER });
  return { user: publicUser(user), ...session };
}

async function authenticateCredentials({ email, password }, { requireAdmin = false } = {}) {
  const foundUser = await prisma.user.findUnique({ where: { email } });
  const user = foundUser?.isSimulationProfile ? null : foundUser;
  const passwordMatches = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!user || !passwordMatches || (requireAdmin && user.role !== 'admin')) {
    throw new AppError('E-mail ou senha inválidos.', 401, 'INVALID_CREDENTIALS');
  }
  return user;
}

async function login(credentials) {
  const user = await authenticateCredentials(credentials);
  await recordAuditLog(user.id, 'user', user.id, 'login');
  const session = await issueSession(user.id, { clientType: AUTH_CLIENTS.USER });
  return { user: publicUser(user), ...session };
}

async function loginAdmin(credentials) {
  const user = await authenticateCredentials(credentials, { requireAdmin: true });
  await recordAuditLog(user.id, 'admin_session', user.id, 'login');
  const session = await issueSession(user.id, { clientType: AUTH_CLIENTS.ADMIN });
  return { user: publicUser(user), ...session };
}

/**
 * Rotação estrita: cada refresh token só pode ser usado uma vez. O frontend
 * já possui single-flight por aplicação; aceitar novamente um token revogado
 * criava uma janela real para cópias roubadas emitirem sucessores válidos.
 */
async function refresh(rawRefreshToken, clientType = AUTH_CLIENTS.USER) {
  if (!rawRefreshToken || rawRefreshToken.length > 256) {
    throw new AppError('Refresh token ausente.', 401, 'UNAUTHORIZED');
  }
  const tokenHash = hashToken(rawRefreshToken);
  const invalidSession = () => new AppError(
    'Sessão expirada ou inválida. Faça login novamente.', 401, 'UNAUTHORIZED'
  );

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.refreshToken.findUnique({ where: { tokenHash } });
    if (!existing || existing.client !== clientType) return { invalid: true };

    const claimed = await tx.refreshToken.updateMany({
      where: {
        id: existing.id,
        client: clientType,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { revokedAt: new Date() },
    });

    // Reuso de um token já consumido é tratado como possível roubo: a família
    // inteira é revogada e a transação PRECISA confirmar antes do 401. Lançar
    // a exceção aqui dentro faria o Prisma desfazer justamente a revogação.
    if (claimed.count !== 1) {
      await tx.refreshToken.updateMany({
        where: { familyId: existing.familyId, client: clientType, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return { invalid: true };
    }

    const user = await tx.user.findUnique({ where: { id: existing.userId } });
    if (!user || user.isSimulationProfile || (clientType === AUTH_CLIENTS.ADMIN && user.role !== 'admin')) {
      await tx.refreshToken.updateMany({
        where: { familyId: existing.familyId, client: clientType, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return { invalid: true };
    }

    const session = await issueSession(existing.userId, {
      clientType,
      client: tx,
      familyId: existing.familyId,
    });
    return { ...session, user: publicUser(user), invalid: false };
  });

  if (result.invalid) throw invalidSession();
  const { invalid, ...session } = result;
  return session;
}

async function logoutAllDevices(userId, clientType = null) {
  const result = await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null, ...(clientType ? { client: clientType } : {}) },
    data: { revokedAt: new Date() },
  });
  await recordAuditLog(userId, 'user', userId, 'logout_all_devices');
  return { revokedSessions: result.count };
}

async function logout(rawRefreshToken, clientType = AUTH_CLIENTS.USER) {
  if (!rawRefreshToken) return;
  const tokenHash = hashToken(rawRefreshToken);
  const token = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    select: { familyId: true, client: true },
  });
  if (!token || token.client !== clientType) return;
  await prisma.refreshToken.updateMany({
    where: { familyId: token.familyId, client: clientType, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

async function forgotPassword(email) {
  // Em produção, falhar claramente é mais seguro do que responder “enviado”
  // quando nenhum provedor está configurado. A checagem acontece antes da
  // busca do usuário para não revelar se o endereço existe.
  if (env.NODE_ENV === 'production' && !isMailConfigured()) {
    throw new AppError(
      'A recuperação de senha está temporariamente indisponível.',
      503,
      'MAIL_DELIVERY_UNAVAILABLE'
    );
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.isSimulationProfile) return { devToken: null };
  const rawToken = generateOpaqueToken();
  const reset = await prisma.passwordReset.create({
    data: { userId: user.id, tokenHash: hashToken(rawToken), expiresAt: passwordResetExpiryDate() },
  });
  const resetUrl = `${env.FRONTEND_URL.replace(/\/$/, '')}/reset-password?token=${rawToken}`;
  const delivery = await sendPasswordResetEmail(user.email, user.name, resetUrl);
  if (!delivery.sent && env.NODE_ENV === 'production') {
    await prisma.passwordReset.delete({ where: { id: reset.id } }).catch(() => {});
    throw new AppError(
      'A recuperação de senha está temporariamente indisponível.',
      503,
      'MAIL_DELIVERY_UNAVAILABLE'
    );
  }
  await recordAuditLog(user.id, 'user', user.id, 'password_reset_requested');
  return { devToken: env.NODE_ENV !== 'production' ? rawToken : null };
}

async function resetPassword({ token, password }) {
  const tokenHash = hashToken(token);
  const rec = await prisma.passwordReset.findUnique({ where: { tokenHash } });
  if (!rec) {
    throw new AppError('Token de redefinição inválido ou expirado.', 400, 'INVALID_RESET_TOKEN');
  }

  // O hash é calculado antes da transação (bcrypt é CPU-bound), mas o token
  // só é "consumido" atomicamente dentro dela. Duas requisições simultâneas
  // não conseguem redefinir a senha com o mesmo link.
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const now = new Date();
  const resetUserId = await prisma.$transaction(async (tx) => {
    const claimed = await tx.passwordReset.updateMany({
      where: {
        id: rec.id,
        usedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) {
      throw new AppError('Token de redefinição inválido ou expirado.', 400, 'INVALID_RESET_TOKEN');
    }

    await tx.user.update({ where: { id: rec.userId }, data: { passwordHash } });
    // Invalida todos os outros links pendentes e todas as sessões.
    await tx.passwordReset.updateMany({
      where: { userId: rec.userId, usedAt: null },
      data: { usedAt: now },
    });
    await tx.refreshToken.updateMany({
      where: { userId: rec.userId, revokedAt: null },
      data: { revokedAt: now },
    });
    return rec.userId;
  });
  await recordAuditLog(resetUserId, 'user', resetUserId, 'password_reset_completed');
}

async function me(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.isSimulationProfile) throw new AppError('Usuário não encontrado.', 404, 'USER_NOT_FOUND');
  return publicUser(user);
}

async function updateProfile(userId, { name }) {
  const user = await prisma.user.update({ where: { id: userId }, data: { name } });
  await recordAuditLog(userId, 'user', userId, 'update', { newValue: { name } });
  return publicUser(user);
}

module.exports = {
  register,
  login,
  loginAdmin,
  refresh,
  logout,
  logoutAllDevices,
  forgotPassword,
  resetPassword,
  me,
  updateProfile,
};
