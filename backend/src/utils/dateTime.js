const {
  getRequestTimeZone,
  getRequestClientDate,
  getRequestFinancialDate,
  localServerDate,
} = require('./requestContext');

const DEFAULT_TIME_ZONE = process.env.APP_TIME_ZONE || 'America/Sao_Paulo';

function resolvedTimeZone(timeZone) {
  return timeZone || getRequestTimeZone() || DEFAULT_TIME_ZONE;
}

function getDateParts(date = new Date(), timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: resolvedTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)])
  );
  return { year: parts.year, month: parts.month, day: parts.day };
}

function utcDateFromParts(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day));
}

function partsFromUtcDate(date) {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

/**
 * Data civil real da requisição. O relógio do computador pode adiantar em até
 * dois dias (validação feita no requestContext), mas nunca pode atrasar a
 * virada já reconhecida pelo servidor. Isso impede uma aba/computador atrasado
 * de manter um mês anterior aberto.
 */
function getRealCalendarDateParts(timeZone) {
  const server = localServerDate(resolvedTimeZone(timeZone));
  const client = getRequestClientDate();
  // A regra do produto usa a data civil do computador. Ela só é aceita quando
  // está próxima da data calculada pelo servidor (validação no requestContext).
  // Usamos a mais recente das duas: um PC atrasado nunca posterga o fechamento,
  // enquanto um PC corretamente adiantado pela virada do fuso pode reconhecê-la.
  if (client && client.date.getTime() > server.date.getTime()) {
    return { year: client.year, month: client.month, day: client.day };
  }
  return { year: server.year, month: server.month, day: server.day };
}

/** Data financeira do workspace. Simulações têm relógio próprio. */
function getCalendarDateParts(timeZone) {
  const financialDate = getRequestFinancialDate();
  return financialDate ? partsFromUtcDate(financialDate) : getRealCalendarDateParts(timeZone);
}

function todayUtcDate(timeZone) {
  const { year, month, day } = getCalendarDateParts(timeZone);
  return utcDateFromParts(year, month, day);
}

function endOfUtcDate(date) {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    23, 59, 59, 999
  ));
}

function isFutureDate(date, timeZone) {
  return date > endOfUtcDate(todayUtcDate(resolvedTimeZone(timeZone)));
}

function monthDateRange(year, month) {
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)),
  };
}

module.exports = {
  DEFAULT_TIME_ZONE,
  getDateParts,
  getRealCalendarDateParts,
  getCalendarDateParts,
  utcDateFromParts,
  todayUtcDate,
  endOfUtcDate,
  isFutureDate,
  monthDateRange,
};
