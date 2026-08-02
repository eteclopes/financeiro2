const prisma = require('../../config/prisma');
const AppError = require('../../utils/AppError');
const { getCalendarDateParts } = require('../../utils/dateTime');
const { addMonths } = require('../../utils/monthMath');

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
  const { month, year } = getCalendarDateParts();
  return getOrCreateMonth(userId, month, year, client);
}


async function findCurrentMonthOrThrow(userId, client = prisma) {
  const { month, year } = getCalendarDateParts();
  const current = await client.month.findUnique({
    where: { userId_month_year: { userId, month, year } },
  });
  if (!current) {
    throw new AppError(
      'O calendário financeiro ainda não foi sincronizado. Atualize a lista de meses.',
      409,
      'CALENDAR_SYNC_REQUIRED'
    );
  }
  return current;
}

/**
 * A simulação não segue o calendário real. Seu "mês atual" é o primeiro mês
 * aberto da linha do tempo manual. Isso evita criar agosto/2026 dentro de uma
 * simulação que começou, por exemplo, em janeiro/2027.
 */
async function getSimulationCurrentMonth(userId, client = prisma) {
  // O relógio do workspace já foi carregado no contexto da requisição.
  // Nunca há fallback para o calendário real.
  const { month, year } = getCalendarDateParts();
  return getOrCreateMonth(userId, month, year, client);
}

// true se a for cronologicamente DEPOIS de b.
function isAfterYm(a, b) {
  return a.year > b.year || (a.year === b.year && a.month > b.month);
}

async function listMonths(userId, options = {}) {
  const months = await prisma.month.findMany({
    where: { userId },
    select: { id: true, userId: true, month: true, year: true, status: true, closedAt: true, createdAt: true },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
  });

  // Em uma simulação todos os meses pertencem à linha do tempo escolhida pelo
  // usuário. Não se aplica a fronteira da data real do computador.
  if (options.includeFuture === true) return months;

  // FRONTEIRA de exibição do modo real: o mais recente entre (mês do
  // calendário de hoje) e (mês seguinte ao último mês FECHADO). Meses
  // estritamente ALÉM da fronteira são ocultados da navegação — eles existem
  // apenas porque uma fatura de cartão foi lançada lá.
  const today = getCalendarDateParts();
  let frontier = { month: today.month, year: today.year };

  const closed = months.filter((m) => m.status === 'closed');
  if (closed.length > 0) {
    // months já vem ordenado desc; o primeiro fechado é o mais recente.
    const latestClosed = closed[0];
    const nextAfterClosed = addMonths(Number(latestClosed.month), Number(latestClosed.year), 1);
    if (isAfterYm(nextAfterClosed, frontier)) frontier = nextAfterClosed;
  }

  return months.filter((m) => !isAfterYm({ month: Number(m.month), year: Number(m.year) }, frontier));
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
  findCurrentMonthOrThrow,
  getSimulationCurrentMonth,
  listMonths,
  getMonthOrThrow,
  assertMonthIsOpen,
  assertTransactionDateIsOpen,
};
