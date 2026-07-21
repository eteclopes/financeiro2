const prisma = require('../../config/prisma');
const AppError = require('../../utils/AppError');

/**
 * Praticamente todo módulo financeiro depende de um month_id válido.
 * Este service é o único lugar que cria registros em "months" — nenhum
 * outro módulo deve fazer prisma.month.create() diretamente, para manter
 * a constraint de unicidade (user, mês, ano) como única fonte de verdade.
 *
 * `client` é opcional e por padrão usa o singleton do Prisma; módulos que
 * precisam que esta operação participe de uma transação maior (ex.:
 * fechamento mensal) passam o `tx` recebido de prisma.$transaction.
 */

async function getOrCreateMonth(userId, month, year, client = prisma) {
  const existing = await client.month.findUnique({
    where: { userId_month_year: { userId, month, year } },
  });
  if (existing) return existing;

  return client.month.create({ data: { userId, month, year, status: 'open' } });
}

async function getCurrentMonth(userId, client = prisma) {
  const now = new Date();
  return getOrCreateMonth(userId, now.getMonth() + 1, now.getFullYear(), client);
}

async function listMonths(userId) {
  return prisma.month.findMany({
    where: { userId },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
  });
}

async function getMonthOrThrow(userId, monthId, client = prisma) {
  const month = await client.month.findFirst({ where: { id: monthId, userId } });
  if (!month) {
    throw new AppError('Mês não encontrado.', 404, 'MONTH_NOT_FOUND');
  }
  return month;
}

/**
 * Bloqueia escrita em meses fechados. Esta função deve ser chamada por
 * TODO módulo antes de criar/editar/excluir uma instância vinculada a um
 * mês (receitas, despesas, faturas) — é a garantia central de imutabilidade
 * de histórico exigida pelas regras do projeto.
 */
function assertMonthIsOpen(month) {
  if (month.status === 'closed') {
    throw new AppError(
      'Este mês já foi encerrado e seus dados são histórico imutável.',
      409,
      'MONTH_CLOSED'
    );
  }
}

module.exports = {
  getOrCreateMonth,
  getCurrentMonth,
  listMonths,
  getMonthOrThrow,
  assertMonthIsOpen,
};
