const bcrypt = require('bcryptjs');
const prisma = require('../../config/prisma');
const env = require('../../config/env');
const AppError = require('../../utils/AppError');
const { recordAuditLog } = require('../auditLog/auditLog.service');
const { sendPasswordResetEmail } = require('../../utils/mailer');
const { buildEntitlements } = require('../plans/plans.service');
const {
  hashToken, generateOpaqueToken, signAccessToken,
  refreshTokenExpiryDate, passwordResetExpiryDate,
} = require('../../utils/tokens');

const BCRYPT_ROUNDS = 12;

// Hash bcrypt válido mas "morto" (nenhuma senha real corresponde a ele).
// Usado apenas para igualar o tempo de resposta do login quando o e-mail não
// existe — sem isso, `!user` retorna em ~1ms enquanto um e-mail existente
// gasta ~100ms+ em bcrypt.compare, e essa diferença de tempo permite
// enumerar e-mails cadastrados mesmo com uma mensagem de erro genérica.
const DUMMY_PASSWORD_HASH = '$2a$12$RXUW.qmEXBzInhTZlg2mM.VsSzXz7.mx2Ym7fdqSQc5iXHat1EaKC';

function publicUser(user) {
  const entitlements = buildEntitlements(user);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
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

async function issueSession(userId) {
  const accessToken = signAccessToken(userId);
  const rawRefreshToken = generateOpaqueToken();
  await prisma.refreshToken.create({
    data: { userId, tokenHash: hashToken(rawRefreshToken), expiresAt: refreshTokenExpiryDate() },
  });
  if (Math.random() < 0.02) { pruneExpiredTokens(); pruneExpiredPasswordResets(); }
  return { accessToken, refreshToken: rawRefreshToken };
}

async function register({ name, email, password }) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new AppError('Este e-mail já está cadastrado.', 409, 'EMAIL_IN_USE');
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = await prisma.user.create({ data: { name, email, passwordHash } });
  // Depois de commitar — nunca dentro da criação: um bug no audit log não
  // pode impedir a conta de ser criada (ver auditLog.service.js).
  await recordAuditLog(user.id, 'user', user.id, 'register', { newValue: { name, email } });
  const session = await issueSession(user.id);
  return { user: publicUser(user), ...session };
}

async function login({ email, password }) {
  const user = await prisma.user.findUnique({ where: { email } });
  const err = new AppError('E-mail ou senha inválidos.', 401, 'INVALID_CREDENTIALS');

  // bcrypt.compare SEMPRE roda, mesmo quando o e-mail não existe (contra o
  // hash "morto" acima) — mantém o tempo de resposta constante e evita
  // enumeração de e-mails cadastrados por diferença de tempo.
  const passwordMatches = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!user || !passwordMatches) throw err;

  await recordAuditLog(user.id, 'user', user.id, 'login');
  const session = await issueSession(user.id);
  return { user: publicUser(user), ...session };
}

async function refresh(rawRefreshToken) {
  if (!rawRefreshToken) throw new AppError('Refresh token ausente.', 401, 'UNAUTHORIZED');
  const tokenHash = hashToken(rawRefreshToken);
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!existing || existing.revokedAt !== null || existing.expiresAt.getTime() < Date.now()) {
    throw new AppError('Sessão expirada ou inválida. Faça login novamente.', 401, 'UNAUTHORIZED');
  }
  await prisma.refreshToken.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });
  return issueSession(existing.userId);
}

async function logout(rawRefreshToken) {
  if (!rawRefreshToken) return;
  const tokenHash = hashToken(rawRefreshToken);
  await prisma.refreshToken.updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: new Date() } });
}

async function forgotPassword(email) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return { devToken: null };
  const rawToken = generateOpaqueToken();
  await prisma.passwordReset.create({
    data: { userId: user.id, tokenHash: hashToken(rawToken), expiresAt: passwordResetExpiryDate() },
  });
  await recordAuditLog(user.id, 'user', user.id, 'password_reset_requested');

  const resetUrl = `${env.FRONTEND_URL.replace(/\/$/, '')}/reset-password?token=${rawToken}`;
  // Não bloqueia o fluxo em caso de falha de e-mail (provedor fora do ar
  // não deve impedir o usuário de tentar de novo) — erro só é logado.
  await sendPasswordResetEmail(user.email, user.name, resetUrl);

  // SÓ retorna token em development explícito — nunca em production/undefined
  // (em dev, sem SMTP configurado, isso permite testar o fluxo sem e-mail real)
  const devToken = env.NODE_ENV === 'development' ? rawToken : null;
  return { devToken };
}

async function resetPassword({ token, password }) {
  const tokenHash = hashToken(token);
  const rec = await prisma.passwordReset.findUnique({ where: { tokenHash } });
  if (!rec || rec.usedAt !== null || rec.expiresAt.getTime() < Date.now()) {
    throw new AppError('Token de redefinição inválido ou expirado.', 400, 'INVALID_RESET_TOKEN');
  }
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await prisma.$transaction([
    prisma.user.update({ where: { id: rec.userId }, data: { passwordHash } }),
    prisma.passwordReset.update({ where: { id: rec.id }, data: { usedAt: new Date() } }),
    prisma.refreshToken.updateMany({ where: { userId: rec.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  await recordAuditLog(rec.userId, 'user', rec.userId, 'password_reset_completed');
}

async function me(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('Usuário não encontrado.', 404, 'USER_NOT_FOUND');
  return publicUser(user);
}

// Atualiza apenas o nome de exibição. E-mail e senha têm fluxos próprios
// (senha via forgot/reset-password) e não são tocados aqui de propósito.
async function updateProfile(userId, { name }) {
  const user = await prisma.user.update({ where: { id: userId }, data: { name } });
  await recordAuditLog(userId, 'user', userId, 'update', { newValue: { name } });
  return publicUser(user);
}

module.exports = { register, login, refresh, logout, forgotPassword, resetPassword, me, updateProfile };