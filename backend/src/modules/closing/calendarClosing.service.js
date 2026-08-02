const prisma = require('../../config/prisma');
const { getCalendarDateParts } = require('../../utils/dateTime');
const closingService = require('./closing.service');
const automationsService = require('../automations/automations.service');
const monthsService = require('../months/months.service');

function before(a, b) {
  return a.year < b.year || (a.year === b.year && a.month < b.month);
}

/**
 * No ambiente real, a passagem do calendário substitui o botão manual.
 * A primeira consulta de meses no novo calendário fecha, em ordem, todos os
 * meses anteriores ainda abertos. A busca é repetida após cada fechamento,
 * porque fechar janeiro pode criar fevereiro, que também precisa ser fechado
 * quando o usuário só volta ao sistema vários meses depois.
 */
async function ensureCalendarMonthsClosed(userId) {
  const current = getCalendarDateParts();
  await monthsService.getOrCreateMonth(userId, current.month, current.year);

  const closed = [];
  const MAX_MONTHS_PER_SYNC = 240; // proteção contra banco corrompido/loop acidental

  for (let index = 0; index < MAX_MONTHS_PER_SYNC; index += 1) {
    const earliestOpen = await prisma.month.findFirst({
      where: { userId, status: 'open' },
      select: { id: true, month: true, year: true },
      orderBy: [{ year: 'asc' }, { month: 'asc' }],
    });

    if (!earliestOpen || !before(
      { month: Number(earliestOpen.month), year: Number(earliestOpen.year) },
      current
    )) break;

    const result = await closingService.closeMonth(userId, earliestOpen.id);
    if (!result.repaired && result.nextMonth?.id) {
      result.automations = await automationsService.runOnClose(userId, result.nextMonth.id);
    }
    closed.push(result);
  }

  return { current, closed };
}

module.exports = { ensureCalendarMonthsClosed };
