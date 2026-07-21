const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const env = require('../config/env');

/**
 * Tokens opacos (refresh e reset de senha) NUNCA são guardados em texto puro
 * no banco — apenas o hash SHA-256. Se o banco vazar, os tokens em si
 * continuam inúteis para um atacante, igual já fazemos com a senha (bcrypt).
 */
function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function generateOpaqueToken() {
  return crypto.randomBytes(48).toString('hex');
}

function signAccessToken(userId) {
  return jwt.sign({ sub: String(userId) }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
  });
}

function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET);
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
