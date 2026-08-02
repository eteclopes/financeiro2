const env = require('../../config/env');
const asyncHandler = require('../../utils/asyncHandler');
const authService = require('./auth.service');
const { AUTH_CLIENTS } = require('../../utils/tokens');

const LEGACY_REFRESH_COOKIE_NAME = 'refresh_token';
const REFRESH_COOKIE_NAME = env.NODE_ENV === 'production'
  ? '__Host-financehub_refresh'
  : 'financehub_refresh';

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
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

function clearLegacyRefreshCookies(res) {
  // Versões antigas usaram tanto Path=/api/auth quanto Path=/. Apagar os dois
  // evita que um cookie legado continue sendo escolhido pelo navegador.
  res.clearCookie(LEGACY_REFRESH_COOKIE_NAME, { path: '/api/auth' });
  res.clearCookie(LEGACY_REFRESH_COOKIE_NAME, { path: '/' });
}

function writeRefreshCookie(res, rawToken) {
  res.cookie(REFRESH_COOKIE_NAME, rawToken, refreshCookieOptions());
  clearLegacyRefreshCookies(res);
}

function sendSession(res, status, { user, accessToken, refreshToken }) {
  writeRefreshCookie(res, refreshToken);
  return res.status(status).json({ user, accessToken });
}

const register = asyncHandler(async (req, res) => sendSession(res, 201, await authService.register(req.body)));
const login = asyncHandler(async (req, res) => sendSession(res, 200, await authService.login(req.body)));
const refresh = asyncHandler(async (req, res) => {
  const result = await authService.refresh(readRefreshToken(req), AUTH_CLIENTS.USER);
  writeRefreshCookie(res, result.refreshToken);
  res.status(200).json({ accessToken: result.accessToken, user: result.user });
});
const logout = asyncHandler(async (req, res) => {
  await authService.logout(readRefreshToken(req), AUTH_CLIENTS.USER);
  res.clearCookie(REFRESH_COOKIE_NAME, clearCookieOptions());
  clearLegacyRefreshCookies(res);
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
const logoutAll = asyncHandler(async (req, res) => {
  const result = await authService.logoutAllDevices(req.userId);
  res.clearCookie(REFRESH_COOKIE_NAME, clearCookieOptions());
  clearLegacyRefreshCookies(res);
  res.status(200).json(result);
});
const me = asyncHandler(async (req, res) => res.json({ user: await authService.me(req.userId) }));
const updateProfile = asyncHandler(async (req, res) => res.json({ user: await authService.updateProfile(req.userId, req.body) }));

module.exports = { register, login, refresh, logout, logoutAll, forgotPassword, resetPassword, me, updateProfile };
