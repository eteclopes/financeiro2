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

function localizationContext(req, res, next) {
  const requestedTimeZone = req.get('x-time-zone');
  const requestedCurrency = req.get('x-currency');
  const context = {
    timeZone: validTimeZone(requestedTimeZone) ? requestedTimeZone : DEFAULT_TIME_ZONE,
    locale: firstLanguageHeader(req.get('accept-language')),
    currency: validCurrency(requestedCurrency) ? requestedCurrency.toUpperCase() : DEFAULT_CURRENCY,
  };
  storage.run(context, next);
}

function currentContext() {
  return storage.getStore() || {
    timeZone: DEFAULT_TIME_ZONE,
    locale: DEFAULT_LOCALE,
    currency: DEFAULT_CURRENCY,
  };
}

function getRequestTimeZone() { return currentContext().timeZone; }
function getRequestLocale() { return currentContext().locale; }
function getRequestCurrency() { return currentContext().currency; }

module.exports = {
  localizationContext,
  getRequestTimeZone,
  getRequestLocale,
  getRequestCurrency,
  validTimeZone,
};
