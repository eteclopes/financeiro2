const env = require('../../config/env');
const asyncHandler = require('../../utils/asyncHandler');
const authService = require('./auth.service');

const REFRESH_COOKIE_NAME = 'refresh_token';

function refreshCookieOptions() {
  return {
    httpOnly: true,
    // Em produção o frontend (Vercel) e o backend (Render) ficam em domínios
    // diferentes, então o cookie precisa ser cross-site: sameSite 'none' exige
    // secure true (só funciona em HTTPS, que é o caso em produção).
    secure: env.NODE_ENV === 'production',
    sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
    path: '/api/auth',
    maxAge: env.JWT_REFRESH_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000,
  };
}

function sendSession(res, status, { user, accessToken, refreshToken }) {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());
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
  const rawRefreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
  const result = await authService.refresh(rawRefreshToken);
  res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, refreshCookieOptions());
  res.status(200).json({ accessToken: result.accessToken });
});

const logout = asyncHandler(async (req, res) => {
  const rawRefreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
  await authService.logout(rawRefreshToken);
  res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth' });
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
