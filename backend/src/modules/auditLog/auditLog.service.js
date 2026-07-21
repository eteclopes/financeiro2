const prisma = require('../../config/prisma');

/**
 * Converte BigInt (ids) para string antes de gravar em uma coluna Json —
 * JSON.stringify lança TypeError em BigInt sem isto. Decimal do Prisma já
 * implementa toJSON() (vira string), não precisa de tratamento especial.
 * Retorna undefined para null/undefined (Prisma trata `undefined` como
 * "não definir o campo", diferente de `null` explícito).
 */
function serialize(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v)));
}

/**
 * Registra uma ação sensível (login, criação/edição/exclusão de dados
 * financeiros, fechamento de mês, etc.) para auditoria.
 *
 * DECISÃO IMPORTANTE: isto é chamado DEPOIS que a operação de negócio já
 * commitou (nunca de dentro do mesmo $transaction). Um audit log é uma
 * preocupação secundária — se o registro do log falhar (bug, coluna
 * inesperada, etc.), isso NUNCA pode reverter uma compra/pagamento/depósito
 * que já aconteceu de verdade. O custo é não ser 100% atômico (uma queda
 * de processo bem no meio do caminho deixaria a ação sem log); o benefício
 * é que um bug na auditoria não pode nunca quebrar uma função financeira.
 * Mesmo princípio já usado em auth.service.js (pruneExpiredTokens/
 * pruneExpiredPasswordResets): dispara e não deixa a falha propagar.
 *
 * @param {bigint} userId
 * @param {string} entity - ex.: 'debt', 'card', 'savingsTransaction', 'user'
 * @param {bigint} entityId
 * @param {string} action - ex.: 'create', 'update', 'delete', 'login', 'logout'
 * @param {{oldValue?: object|null, newValue?: object|null}} [snapshot]
 */
async function recordAuditLog(userId, entity, entityId, action, { oldValue, newValue } = {}) {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        entity,
        entityId,
        action,
        oldValueJson: oldValue === undefined ? undefined : serialize(oldValue),
        newValueJson: newValue === undefined ? undefined : serialize(newValue),
      },
    });
  } catch (err) {
    // Nunca propaga — ver justificativa acima. Loga para não ficar
    // silenciosamente invisível caso o auditLog pare de funcionar.
    console.error(`[auditLog] falha ao registrar ${entity}/${action} (operação de negócio não foi afetada):`, err.message);
  }
}

module.exports = { recordAuditLog };
