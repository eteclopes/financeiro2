const { getRequestTimeZone } = require('./requestContext');

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

function todayUtcDate(timeZone) {
  const { year, month, day } = getDateParts(new Date(), resolvedTimeZone(timeZone));
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
  utcDateFromParts,
  todayUtcDate,
  endOfUtcDate,
  isFutureDate,
  monthDateRange,
};
