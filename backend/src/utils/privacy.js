const crypto = require('node:crypto');

const TECHNICAL_FIELDS = new Set([
  'id', 'userId', 'user_id', 'createdAt', 'created_at', 'updatedAt', 'updated_at',
  'passwordHash', 'password_hash', 'tokenHash', 'token_hash',
]);

// Estados operacionais que ajudam a investigar incidentes sem revelar valores,
// descrições, nomes, e-mails ou anotações particulares do usuário.
const SAFE_STATE_FIELDS = new Set([
  'status', 'type', 'active', 'plan', 'planSource', 'plan_source',
  'paymentMethod', 'payment_method', 'origin', 'source', 'severity',
  'month', 'year', 'referenceMonth', 'referenceYear',
]);

function stablePrimitive(value) {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (value && typeof value.toJSON === 'function') return value.toJSON();
  return String(value);
}

function listFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.keys(value)
    .filter((key) => !TECHNICAL_FIELDS.has(key))
    .sort();
}

function safeState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const state = {};
  for (const key of SAFE_STATE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      state[key] = stablePrimitive(value[key]);
    }
  }
  return Object.keys(state).length ? state : undefined;
}

/**
 * Produz um resumo de auditoria sem conteúdo financeiro ou pessoal.
 * O banco registra quais campos participaram da operação e estados técnicos
 * úteis (ex.: status=paid), mas nunca valores, saldos, descrições, observações,
 * nomes, e-mails, payloads de simulação ou dados de cartão.
 */
function summarizeAuditValue(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (Array.isArray(value)) return { itemCount: value.length };
  if (typeof value !== 'object') return { present: true };

  const fields = listFields(value);
  const state = safeState(value);
  return {
    privacyVersion: 1,
    ...(fields.length ? { fields } : {}),
    ...(state ? { state } : {}),
  };
}

function changedFields(oldValue, newValue) {
  if (!oldValue || !newValue || typeof oldValue !== 'object' || typeof newValue !== 'object') {
    return undefined;
  }

  const keys = new Set([...listFields(oldValue), ...listFields(newValue)]);
  const changed = [...keys].filter((key) => {
    const before = stablePrimitive(oldValue[key]);
    const after = stablePrimitive(newValue[key]);
    return JSON.stringify(before) !== JSON.stringify(after);
  }).sort();

  return changed.length ? changed : undefined;
}

function buildAuditSnapshot(oldValue, newValue) {
  const oldSummary = summarizeAuditValue(oldValue);
  const newSummary = summarizeAuditValue(newValue);
  const changed = changedFields(oldValue, newValue);

  if (changed && newSummary && typeof newSummary === 'object') {
    newSummary.changedFields = changed;
  }
  return { oldSummary, newSummary };
}

function maskEmail(email) {
  const input = String(email || '').trim();
  const [local, domain] = input.split('@');
  if (!local || !domain) return '[redacted-email]';
  const first = local.slice(0, 1);
  return `${first}${'*'.repeat(Math.min(Math.max(local.length - 1, 3), 8))}@${domain}`;
}

function sanitizeLogText(value, maxLength = 240) {
  const text = String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]')
    .replace(/([?&](?:token|code|secret|password|key)=)[^&\s]+/gi, '$1[redacted]')
    .trim();
  return text.slice(0, maxLength);
}

function errorFingerprint(err) {
  return crypto
    .createHash('sha256')
    .update(`${err?.name || 'Error'}:${err?.code || ''}:${err?.message || ''}`)
    .digest('hex')
    .slice(0, 12);
}

module.exports = {
  summarizeAuditValue,
  buildAuditSnapshot,
  maskEmail,
  sanitizeLogText,
  errorFingerprint,
};
