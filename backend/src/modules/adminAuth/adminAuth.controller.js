const env = require('../../config/env');
const asyncHandler = require('../../utils/asyncHandler');
const authService = require('../auth/auth.service');
const { AUTH_CLIENTS } = require('../../utils/tokens');

const COOKIE_NAME = env.NODE_ENV === 'production'
  ? '__Secure-financehub_admin_refresh'
  : 'financehub_admin_refresh';

function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
    path: '/api/admin-auth',
    maxAge: env.JWT_REFRESH_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000,
    priority: 'high',
  };
}
function clearOptions() { const { maxAge, ...rest } = cookieOptions(); return rest; }
function read(req) { return req.cookies?.[COOKIE_NAME]; }
function write(res, value) { res.cookie(COOKIE_NAME, value, cookieOptions()); }
function send(res, result) {
  write(res, result.refreshToken);
  res.json({ user: result.user, accessToken: result.accessToken });
}

const login = asyncHandler(async (req, res) => send(res, await authService.loginAdmin(req.body)));
const refresh = asyncHandler(async (req, res) => send(res, await authService.refresh(read(req), AUTH_CLIENTS.ADMIN)));
const logout = asyncHandler(async (req, res) => {
  await authService.logout(read(req), AUTH_CLIENTS.ADMIN);
  res.clearCookie(COOKIE_NAME, clearOptions());
  res.status(204).send();
});
const me = asyncHandler(async (req, res) => res.json({ user: await authService.me(req.userId) }));

module.exports = { login, refresh, logout, me };
