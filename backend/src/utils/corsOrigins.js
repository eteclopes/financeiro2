function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeOrigin(rawOrigin) {
  if (typeof rawOrigin !== 'string') return null;

  const trimmed = rawOrigin.trim().replace(/\/+$/, '');
  if (!trimmed || trimmed === '*') return null;

  const hasProtocol = /^https?:\/\//i.test(trimmed);
  const isLocal = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?$/i.test(trimmed);
  const candidate = hasProtocol
    ? trimmed
    : `${isLocal ? 'http' : 'https'}://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function parseConfiguredOrigins(rawValue) {
  if (typeof rawValue !== 'string') return [];

  return [...new Set(
    rawValue
      .split(/[;,\n]/)
      .map(normalizeOrigin)
      .filter(Boolean),
  )];
}

function buildVercelPreviewRegex(projectName, teamSlug) {
  const project = String(projectName || '').trim().toLowerCase();
  const team = String(teamSlug || '').trim().toLowerCase();

  if (!/^[a-z0-9-]+$/.test(project) || !/^[a-z0-9-]+$/.test(team)) {
    return null;
  }

  return new RegExp(
    `^https://${escapeRegExp(project)}(?:-[a-z0-9-]+)?-${escapeRegExp(team)}\\.vercel\\.app$`,
    'i',
  );
}

function createOriginPolicy({ configuredOrigins = [], vercelProject, vercelTeam } = {}) {
  const exactOrigins = new Set(
    configuredOrigins.map(normalizeOrigin).filter(Boolean),
  );
  const vercelPreviewRegex = buildVercelPreviewRegex(vercelProject, vercelTeam);

  function isAllowed(origin) {
    // Requisições servidor-servidor, health checks e ferramentas como curl não
    // enviam Origin. CORS é uma proteção do navegador, então essas chamadas
    // continuam permitidas e ainda dependem normalmente de autenticação.
    if (!origin) return true;

    const normalized = normalizeOrigin(origin);
    if (!normalized) return false;
    if (exactOrigins.has(normalized)) return true;
    return Boolean(vercelPreviewRegex?.test(normalized));
  }

  return {
    exactOrigins: [...exactOrigins],
    vercelPreviewRegex,
    isAllowed,
  };
}

module.exports = {
  normalizeOrigin,
  parseConfiguredOrigins,
  buildVercelPreviewRegex,
  createOriginPolicy,
};
