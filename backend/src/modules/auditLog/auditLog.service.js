const prisma = require('../../config/prisma');
const { buildAuditSnapshot, sanitizeLogText } = require('../../utils/privacy');

/**
 * Registra ações importantes sem duplicar dados financeiros ou pessoais.
 *
 * O audit_log guarda somente:
 * - usuário responsável (FK já existente), entidade, id e ação;
 * - nomes dos campos envolvidos;
 * - estados técnicos não sensíveis, como status/active/type.
 *
 * Valores, saldos, limites, descrições, observações, nomes, e-mails, tokens e
 * payloads de simulação nunca são copiados para o log. Isso reduz a superfície
 * de exposição caso alguém acesse a tabela de auditoria.
 *
 * Para o núcleo do ledger (receitas, despesas, reservas, metas, faturas,
 * compras, dívidas e meses), a migration V30 também grava um evento mínimo
 * por trigger PostgreSQL DENTRO da mesma transação. Esta função é a trilha
 * complementar, mais semântica, usada por ações de produto/administração.
 * Como ela pode ocorrer depois do commit, nunca deve ser a única evidência de
 * uma mutação financeira crítica.
 */
async function recordAuditLog(userId, entity, entityId, action, { oldValue, newValue } = {}) {
  try {
    const { oldSummary, newSummary } = buildAuditSnapshot(oldValue, newValue);
    await prisma.auditLog.create({
      data: {
        userId,
        entity,
        entityId,
        action,
        oldValueJson: oldSummary,
        newValueJson: newSummary,
      },
    });
  } catch (err) {
    // Não inclui entityId, payload nem mensagem completa do driver, pois erros
    // de banco podem conter detalhes de consulta. O suficiente para suporte é
    // saber qual módulo/ação falhou.
    console.error(
      `[auditLog] falha em ${sanitizeLogText(entity, 40)}/${sanitizeLogText(action, 40)}; ` +
      'a operação principal não foi revertida.'
    );
  }
}

module.exports = { recordAuditLog };
