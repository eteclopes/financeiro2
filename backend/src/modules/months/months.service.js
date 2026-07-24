const prisma = require('../../config/prisma');
const AppError = require('../../utils/AppError');
const { getDateParts } = require('../../utils/dateTime');

async function getOrCreateMonth(userId, month, year, client = prisma) {
  const where = { userId_month_year: { userId, month, year } };
  const existing = await client.month.findUnique({ where });
  if (existing) return existing;

  try {
    return await client.month.create({ data: { userId, month, year, status: 'open' } });
  } catch (error) {
    // Duas requisições podem tentar abrir o mesmo mês simultaneamente.
    if (error?.code === 'P2002') {
      const concurrent = await client.month.findUnique({ where });
      if (concurrent) return concurrent;
    }
    throw error;
  }
}

async function getCurrentMonth(userId, client = prisma) {
  const { month, year } = getDateParts();
  return getOrCreateMonth(userId, month, year, client);
}

async function listMonths(userId) {
  return prisma.month.findMany({
    where: { userId },
    select: { id: true, userId: true, month: true, year: true, status: true, closedAt: true, createdAt: true },
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


async function assertTransactionDateIsOpen(userId, date, client = prisma) {
  const month = date.getUTCMonth() + 1;
  const year = date.getUTCFullYear();
  const ledgerMonth = await client.month.findUnique({
    where: { userId_month_year: { userId, month, year } },
  });
  if (ledgerMonth?.status === 'closed') {
    throw new AppError(
      'Essa data pertence a um mês encerrado. Troque para um mês aberto para registrar a movimentação.',
      409,
      'MONTH_CLOSED'
    );
  }
  return ledgerMonth;
}

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
  assertTransactionDateIsOpen,
};
