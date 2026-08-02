const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const env = require('../config/env');

const AUTH_CLIENTS = Object.freeze({
  USER: 'user_app',
  ADMIN: 'admin_app',
});

function audienceFor(client) {
  return client === AUTH_CLIENTS.ADMIN ? env.JWT_ADMIN_AUDIENCE : env.JWT_AUDIENCE;
}

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function generateOpaqueToken() {
  return crypto.randomBytes(48).toString('hex');
}

function signAccessToken(userId, client = AUTH_CLIENTS.USER) {
  return jwt.sign(
    { sub: String(userId), typ: 'access', client },
    env.JWT_ACCESS_SECRET,
    {
      algorithm: 'HS256',
      expiresIn: env.JWT_ACCESS_EXPIRES_IN,
      issuer: env.JWT_ISSUER,
      audience: audienceFor(client),
    }
  );
}

function verifyAccessToken(token, expectedClient = AUTH_CLIENTS.USER) {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
    algorithms: ['HS256'],
    issuer: env.JWT_ISSUER,
    audience: audienceFor(expectedClient),
  });
  if (payload.client !== expectedClient) throw new Error('invalid token client');
  return payload;
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
  AUTH_CLIENTS,
  hashToken,
  generateOpaqueToken,
  signAccessToken,
  verifyAccessToken,
  refreshTokenExpiryDate,
  passwordResetExpiryDate,
};
