/**
 * Prepara a URL de runtime do Prisma para uso com o pooler do Supabase.
 *
 * O Supavisor/PgBouncer pode trocar a conexão física entre consultas. Sem o
 * modo de compatibilidade, o Prisma reutiliza prepared statements nomeados que
 * podem deixar de existir na conexão seguinte (erro PostgreSQL 26000).
 *
 * A função não altera conexões diretas. Em URLs do pooler do Supabase, garante
 * `pgbouncer=true`, o que desativa o cache de prepared statements do Prisma.
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

module.exports = { normalizePrismaRuntimeUrl };
