/**
 * Prepara a URL de runtime do Prisma para uso com o pooler do Supabase.
 */
function normalizePrismaRuntimeUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') return rawUrl;

  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return rawUrl;
  }

  const hostname = parsed.hostname.toLowerCase();
  const isSupabasePooler = hostname.endsWith('.pooler.supabase.com');

  if (!isSupabasePooler) return rawUrl.trim();

  parsed.searchParams.set('pgbouncer', 'true');
  return parsed.toString();
}

/**
 * Não força um parâmetro específico porque provedores gerenciados podem
 * negociar TLS sem `sslmode` explícito. Em produção, porém, recusa URLs que
 * declaram de forma inequívoca que a conexão pode ficar sem criptografia.
 */
function getDatabaseTransportIssue(rawUrl, nodeEnv = 'development') {
  if (nodeEnv !== 'production') return null;
  let parsed;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch {
    return 'URL de banco inválida.';
  }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    return 'O banco precisa usar uma URL PostgreSQL.';
  }

  const sslMode = parsed.searchParams.get('sslmode')?.toLowerCase();
  if (['disable', 'allow', 'prefer'].includes(sslMode)) {
    return `sslmode=${sslMode} não é permitido em produção; use TLS obrigatório.`;
  }
  return null;
}

module.exports = { normalizePrismaRuntimeUrl, getDatabaseTransportIssue };
