const { AsyncLocalStorage } = require('node:async_hooks');

const storage = new AsyncLocalStorage();
const DEFAULT_TIME_ZONE = process.env.APP_TIME_ZONE || 'America/Sao_Paulo';
const DEFAULT_LOCALE = process.env.APP_LOCALE || 'pt-BR';
const DEFAULT_CURRENCY = process.env.APP_CURRENCY || 'BRL';

function validTimeZone(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 80) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function validLocale(value) {
  if (typeof value !== 'string' || value.length < 2 || value.length > 35) return false;
  try {
    Intl.getCanonicalLocales(value);
    return true;
  } catch {
    return false;
  }
}

function validCurrency(value) {
  if (typeof value !== 'string' || !/^[A-Za-z]{3}$/.test(value)) return false;
  try {
    new Intl.NumberFormat('en-US', { style: 'currency', currency: value.toUpperCase() }).format(0);
    return true;
  } catch {
    return false;
  }
}

function firstLanguageHeader(value) {
  if (typeof value !== 'string') return DEFAULT_LOCALE;
  const locale = value.split(',')[0]?.split(';')[0]?.trim();
  return validLocale(locale) ? Intl.getCanonicalLocales(locale)[0] : DEFAULT_LOCALE;
}

function parseIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return { year, month, day, date };
}

function localServerDate(timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date())
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, Number(part.value)]));
  return { ...parts, date: new Date(Date.UTC(parts.year, parts.month - 1, parts.day)) };
}

function trustedClientDate(value, timeZone) {
  const parsed = parseIsoDate(value);
  if (!parsed) return null;
  const server = localServerDate(timeZone);
  const days = Math.abs(parsed.date.getTime() - server.date.getTime()) / 86_400_000;
  return days <= 2 ? parsed : null;
}

function localizationContext(req, _res, next) {
  const requestedTimeZone = req.get('x-time-zone');
  const requestedCurrency = req.get('x-currency');
  const timeZone = validTimeZone(requestedTimeZone) ? requestedTimeZone : DEFAULT_TIME_ZONE;
  const context = {
    timeZone,
    locale: firstLanguageHeader(req.get('accept-language')),
    currency: validCurrency(requestedCurrency) ? requestedCurrency.toUpperCase() : DEFAULT_CURRENCY,
    clientDate: trustedClientDate(req.get('x-client-date'), timeZone),
    financialDate: null,
    workspaceType: 'real',
    workspaceId: 'real',
    authClient: null,
  };
  storage.run(context, next);
}

function currentContext() {
  return storage.getStore() || {
    timeZone: DEFAULT_TIME_ZONE,
    locale: DEFAULT_LOCALE,
    currency: DEFAULT_CURRENCY,
    clientDate: null,
    financialDate: null,
    workspaceType: 'real',
    workspaceId: 'real',
    authClient: null,
  };
}

function setRequestFinancialContext({ financialDate, workspaceType, workspaceId, authClient } = {}) {
  const context = storage.getStore();
  if (!context) return;
  if (financialDate instanceof Date && !Number.isNaN(financialDate.getTime())) {
    context.financialDate = new Date(Date.UTC(
      financialDate.getUTCFullYear(),
      financialDate.getUTCMonth(),
      financialDate.getUTCDate()
    ));
  }
  if (workspaceType) context.workspaceType = workspaceType;
  if (workspaceId != null) context.workspaceId = String(workspaceId);
  if (authClient) context.authClient = authClient;
}

function getRequestTimeZone() { return currentContext().timeZone; }
function getRequestLocale() { return currentContext().locale; }
function getRequestCurrency() { return currentContext().currency; }
function getRequestClientDate() { return currentContext().clientDate; }
function getRequestFinancialDate() { return currentContext().financialDate; }
function getRequestWorkspaceType() { return currentContext().workspaceType; }
function getRequestWorkspaceId() { return currentContext().workspaceId; }
function getRequestAuthClient() { return currentContext().authClient; }

module.exports = {
  localizationContext,
  getRequestTimeZone,
  getRequestLocale,
  getRequestCurrency,
  getRequestClientDate,
  getRequestFinancialDate,
  getRequestWorkspaceType,
  getRequestWorkspaceId,
  getRequestAuthClient,
  setRequestFinancialContext,
  parseIsoDate,
  localServerDate,
  validTimeZone,
};
