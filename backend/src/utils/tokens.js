const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const env = require('../config/env');

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function generateOpaqueToken() {
  return crypto.randomBytes(48).toString('hex');
}

function signAccessToken(userId) {
  return jwt.sign(
    { sub: String(userId), typ: 'access' },
    env.JWT_ACCESS_SECRET,
    {
      algorithm: 'HS256',
      expiresIn: env.JWT_ACCESS_EXPIRES_IN,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, {
    algorithms: ['HS256'],
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  });
}

function refreshTokenExpiryDate() {
  const date = new Date();
  date.setDate(date.getDate() + env.JWT_REFRESH_EXPIRES_IN_DAYS);
  return date;
}

function passwordResetExpiryDate() {
  const date = new Date();
  date.setHours(date.getHours() + env.PASSWORD_RESET_EXPIRES_IN_HOURS);
  return date;
}

module.exports = {
  hashToken,
  generateOpaqueToken,
  signAccessToken,
  verifyAccessToken,
  refreshTokenExpiryDate,
  passwordResetExpiryDate,
};
