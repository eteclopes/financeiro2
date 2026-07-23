const env = require('../../config/env');
const asyncHandler = require('../../utils/asyncHandler');
const authService = require('./auth.service');

const LEGACY_REFRESH_COOKIE_NAME = 'refresh_token';
const REFRESH_COOKIE_NAME = env.NODE_ENV === 'production'
  ? '__Host-financehub_refresh'
  : 'financehub_refresh';

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
    // O prefixo __Host- exige Path=/ e ausência de Domain. Isso impede que
    // subdomínios sobrescrevam o cookie em produção.
    path: '/',
    maxAge: env.JWT_REFRESH_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000,
    priority: 'high',
  };
}

function clearCookieOptions() {
  const { maxAge, ...options } = refreshCookieOptions();
  return options;
}

function readRefreshToken(req) {
  return req.cookies?.[REFRESH_COOKIE_NAME] ?? req.cookies?.[LEGACY_REFRESH_COOKIE_NAME];
}

function writeRefreshCookie(res, rawToken) {
  res.cookie(REFRESH_COOKIE_NAME, rawToken, refreshCookieOptions());
  // Limpa o cookie da versão anterior sem interromper sessões na migração.
  res.clearCookie(LEGACY_REFRESH_COOKIE_NAME, { path: '/api/auth' });
}

function sendSession(res, status, { user, accessToken, refreshToken }) {
  writeRefreshCookie(res, refreshToken);
  return res.status(status).json({ user, accessToken });
}

const register = asyncHandler(async (req, res) => {
  const result = await authService.register(req.body);
  sendSession(res, 201, result);
});

const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body);
  sendSession(res, 200, result);
});

const refresh = asyncHandler(async (req, res) => {
  const result = await authService.refresh(readRefreshToken(req));
  writeRefreshCookie(res, result.refreshToken);
  res.status(200).json({ accessToken: result.accessToken });
});

const logout = asyncHandler(async (req, res) => {
  await authService.logout(readRefreshToken(req));
  res.clearCookie(REFRESH_COOKIE_NAME, clearCookieOptions());
  res.clearCookie(LEGACY_REFRESH_COOKIE_NAME, { path: '/api/auth' });
  res.status(204).send();
});

const forgotPassword = asyncHandler(async (req, res) => {
  const { devToken } = await authService.forgotPassword(req.body.email);
  res.status(200).json({
    message: 'Se este e-mail estiver cadastrado, você receberá instruções de redefinição.',
    ...(devToken ? { devToken } : {}),
  });
});

const resetPassword = asyncHandler(async (req, res) => {
  await authService.resetPassword(req.body);
  res.status(200).json({ message: 'Senha redefinida com sucesso.' });
});

const me = asyncHandler(async (req, res) => {
  const user = await authService.me(req.userId);
  res.json({ user });
});

const updateProfile = asyncHandler(async (req, res) => {
  const user = await authService.updateProfile(req.userId, req.body);
  res.json({ user });
});

module.exports = { register, login, refresh, logout, forgotPassword, resetPassword, me, updateProfile };
