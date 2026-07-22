import { create } from 'zustand';
import { LANGUAGE_META, SUPPORTED_LANGUAGES } from '../i18n/translations.js';

const STORAGE_KEY = 'financehub.locale.v2';
const LEGACY_STORAGE_KEY = 'financehub.locale.v1';

export const LANGUAGE_OPTIONS = SUPPORTED_LANGUAGES.map((value) => ({
  value,
  label: LANGUAGE_META[value].nativeName,
  nativeLabel: LANGUAGE_META[value].nativeName,
}));

export const REGION_OPTIONS = [
  { value: 'pt-BR', label: 'Brasil', example: '31/12/2026 · 1.234,56' },
  { value: 'pt-PT', label: 'Portugal', example: '31/12/2026 · 1 234,56' },
  { value: 'en-US', label: 'United States', example: '12/31/2026 · 1,234.56' },
  { value: 'en-GB', label: 'United Kingdom', example: '31/12/2026 · 1,234.56' },
  { value: 'en-CA', label: 'Canada', example: '2026-12-31 · 1,234.56' },
  { value: 'en-AU', label: 'Australia', example: '31/12/2026 · 1,234.56' },
  { value: 'en-NZ', label: 'New Zealand', example: '31/12/2026 · 1,234.56' },
  { value: 'en-IN', label: 'India', example: '31/12/2026 · 1,234.56' },
  { value: 'es-ES', label: 'España', example: '31/12/2026 · 1234,56' },
  { value: 'es-MX', label: 'México', example: '31/12/2026 · 1,234.56' },
  { value: 'es-AR', label: 'Argentina', example: '31/12/2026 · 1.234,56' },
  { value: 'es-CL', label: 'Chile', example: '31-12-2026 · 1.234,56' },
  { value: 'es-CO', label: 'Colombia', example: '31/12/2026 · 1.234,56' },
  { value: 'es-PE', label: 'Perú', example: '31/12/2026 · 1,234.56' },
  { value: 'es-UY', label: 'Uruguay', example: '31/12/2026 · 1.234,56' },
  { value: 'ru-RU', label: 'Россия', example: '31.12.2026 · 1 234,56' },
  { value: 'fr-FR', label: 'France', example: '31/12/2026 · 1 234,56' },
  { value: 'fr-BE', label: 'Belgique', example: '31/12/2026 · 1 234,56' },
  { value: 'fr-CH', label: 'Suisse (français)', example: '31.12.2026 · 1’234.56' },
  { value: 'fr-CA', label: 'Canada (français)', example: '2026-12-31 · 1 234,56' },
  { value: 'de-DE', label: 'Deutschland', example: '31.12.2026 · 1.234,56' },
  { value: 'de-BE', label: 'Belgien', example: '31.12.2026 · 1.234,56' },
  { value: 'de-AT', label: 'Österreich', example: '31.12.2026 · 1 234,56' },
  { value: 'de-CH', label: 'Schweiz', example: '31.12.2026 · 1’234.56' },
  { value: 'ja-JP', label: '日本', example: '2026/12/31 · 1,234.56' },
];

export const CURRENCY_OPTIONS = [
  { value: 'BRL', label: 'Real brasileiro (BRL)' },
  { value: 'USD', label: 'US Dollar (USD)' },
  { value: 'EUR', label: 'Euro (EUR)' },
  { value: 'GBP', label: 'Pound sterling (GBP)' },
  { value: 'RUB', label: 'Russian ruble (RUB)' },
  { value: 'MXN', label: 'Mexican peso (MXN)' },
  { value: 'ARS', label: 'Argentine peso (ARS)' },
  { value: 'CLP', label: 'Chilean peso (CLP)' },
  { value: 'COP', label: 'Colombian peso (COP)' },
  { value: 'PEN', label: 'Peruvian sol (PEN)' },
  { value: 'CAD', label: 'Canadian dollar (CAD)' },
  { value: 'AUD', label: 'Australian dollar (AUD)' },
  { value: 'NZD', label: 'New Zealand dollar (NZD)' },
  { value: 'CHF', label: 'Swiss franc (CHF)' },
  { value: 'INR', label: 'Indian rupee (INR)' },
  { value: 'JPY', label: 'Japanese yen (JPY)' },
  { value: 'UYU', label: 'Uruguayan peso (UYU)' },
];

export const TIME_ZONE_OPTIONS = [
  { value: 'America/Sao_Paulo', label: 'Brasília / São Paulo' },
  { value: 'America/Manaus', label: 'Manaus' },
  { value: 'America/Rio_Branco', label: 'Rio Branco' },
  { value: 'America/New_York', label: 'New York' },
  { value: 'America/Chicago', label: 'Chicago' },
  { value: 'America/Denver', label: 'Denver' },
  { value: 'America/Los_Angeles', label: 'Los Angeles' },
  { value: 'America/Toronto', label: 'Toronto' },
  { value: 'America/Vancouver', label: 'Vancouver' },
  { value: 'America/Mexico_City', label: 'Ciudad de México' },
  { value: 'America/Argentina/Buenos_Aires', label: 'Buenos Aires' },
  { value: 'America/Santiago', label: 'Santiago' },
  { value: 'America/Bogota', label: 'Bogotá' },
  { value: 'America/Lima', label: 'Lima' },
  { value: 'Europe/Lisbon', label: 'Lisboa' },
  { value: 'Europe/London', label: 'London' },
  { value: 'Europe/Madrid', label: 'Madrid' },
  { value: 'Europe/Paris', label: 'Paris' },
  { value: 'Europe/Berlin', label: 'Berlin' },
  { value: 'Europe/Vienna', label: 'Wien' },
  { value: 'Europe/Zurich', label: 'Zürich' },
  { value: 'Europe/Moscow', label: 'Москва' },
  { value: 'Asia/Kolkata', label: 'India' },
  { value: 'Asia/Tokyo', label: 'Tokyo' },
  { value: 'Australia/Sydney', label: 'Sydney' },
  { value: 'Pacific/Auckland', label: 'Auckland' },
  { value: 'UTC', label: 'UTC' },
];

const COUNTRY_DEFAULTS = {
  BR: { language: 'pt', locale: 'pt-BR', currency: 'BRL' },
  PT: { language: 'pt', locale: 'pt-PT', currency: 'EUR' },
  US: { language: 'en', locale: 'en-US', currency: 'USD' },
  GB: { language: 'en', locale: 'en-GB', currency: 'GBP' },
  CA: { language: 'en', locale: 'en-CA', currency: 'CAD' },
  AU: { language: 'en', locale: 'en-AU', currency: 'AUD' },
  NZ: { language: 'en', locale: 'en-NZ', currency: 'NZD' },
  IN: { language: 'en', locale: 'en-IN', currency: 'INR' },
  ES: { language: 'es', locale: 'es-ES', currency: 'EUR' },
  MX: { language: 'es', locale: 'es-MX', currency: 'MXN' },
  AR: { language: 'es', locale: 'es-AR', currency: 'ARS' },
  CL: { language: 'es', locale: 'es-CL', currency: 'CLP' },
  CO: { language: 'es', locale: 'es-CO', currency: 'COP' },
  PE: { language: 'es', locale: 'es-PE', currency: 'PEN' },
  UY: { language: 'es', locale: 'es-UY', currency: 'UYU' },
  RU: { language: 'ru', locale: 'ru-RU', currency: 'RUB' },
  FR: { language: 'fr', locale: 'fr-FR', currency: 'EUR' },
  BE: { language: 'fr', locale: 'fr-FR', currency: 'EUR' },
  DE: { language: 'de', locale: 'de-DE', currency: 'EUR' },
  AT: { language: 'de', locale: 'de-AT', currency: 'EUR' },
  CH: { language: 'de', locale: 'de-CH', currency: 'CHF' },
  JP: { language: 'en', locale: 'ja-JP', currency: 'JPY' },
};

const LANGUAGE_DEFAULTS = {
  pt: { locale: 'pt-BR', currency: 'BRL', timeZone: 'America/Sao_Paulo' },
  en: { locale: 'en-US', currency: 'USD', timeZone: 'America/New_York' },
  es: { locale: 'es-ES', currency: 'EUR', timeZone: 'Europe/Madrid' },
  ru: { locale: 'ru-RU', currency: 'RUB', timeZone: 'Europe/Moscow' },
  fr: { locale: 'fr-FR', currency: 'EUR', timeZone: 'Europe/Paris' },
  de: { locale: 'de-DE', currency: 'EUR', timeZone: 'Europe/Berlin' },
};

function readStored() {
  if (typeof window === 'undefined') return {};
  for (const key of [STORAGE_KEY, LEGACY_STORAGE_KEY]) {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(key) || '{}');
      if (parsed && typeof parsed === 'object' && Object.keys(parsed).length) return parsed;
    } catch {}
  }
  return {};
}

function persist(state) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      language: state.language,
      locale: state.locale,
      currency: state.currency,
      timeZone: state.timeZone,
      countryCode: state.countryCode,
      preferenceMode: state.preferenceMode,
      detectionCompleted: state.detectionCompleted,
    }));
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {}
}

function browserLanguage() {
  if (typeof navigator === 'undefined') return 'pt';
  const candidates = [...(navigator.languages || []), navigator.language].filter(Boolean);
  for (const candidate of candidates) {
    const base = String(candidate).split('-')[0].toLowerCase();
    if (SUPPORTED_LANGUAGES.includes(base)) return base;
  }
  return 'en';
}

function browserRegionalLocale(language) {
  if (typeof navigator === 'undefined') return null;
  const candidate = [...(navigator.languages || []), navigator.language]
    .find((item) => String(item).toLowerCase().startsWith(`${language}-`));
  return REGION_OPTIONS.find((option) => option.value.toLowerCase() === String(candidate).toLowerCase())?.value || null;
}

function browserLocale(language) {
  return browserRegionalLocale(language) || LANGUAGE_DEFAULTS[language]?.locale || 'pt-BR';
}

export function isValidTimeZone(value) {
  if (!value || typeof value !== 'string' || value.length > 80) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function browserTimeZone() {
  try {
    const value = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimeZone(value) ? value : 'UTC';
  } catch {
    return 'UTC';
  }
}

async function detectCountry() {
  if (typeof window === 'undefined') return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch('/api/locale', {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const data = await response.json();
    const countryCode = String(data?.countryCode || '').toUpperCase();
    return /^[A-Z]{2}$/.test(countryCode) ? countryCode : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function detectedPreferences(countryCode) {
  const languageFromBrowser = browserLanguage();
  const country = COUNTRY_DEFAULTS[countryCode] || {};

  // Em países oficialmente multilíngues, respeita o idioma configurado no navegador.
  const multilingual = new Set(['CA', 'CH', 'BE']);
  const proposedLanguage = multilingual.has(countryCode) ? languageFromBrowser : (country.language || languageFromBrowser);
  const language = validLanguage(proposedLanguage) || languageFromBrowser || 'en';
  const defaults = LANGUAGE_DEFAULTS[language] || LANGUAGE_DEFAULTS.en;
  const locale = multilingual.has(countryCode)
    ? (browserRegionalLocale(language) || country.locale || defaults.locale)
    : (country.locale || browserLocale(language));
  return {
    language,
    locale: locale || defaults.locale,
    currency: country.currency || defaults.currency,
    timeZone: browserTimeZone(),
    countryCode: countryCode || null,
  };
}

function validLanguage(value) {
  return SUPPORTED_LANGUAGES.includes(value) ? value : null;
}

function validLocale(value) {
  return REGION_OPTIONS.some((option) => option.value === value) ? value : null;
}

function validCurrency(value) {
  return CURRENCY_OPTIONS.some((option) => option.value === value) ? value : null;
}

function applyDocumentMetadata(state) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = state.language || 'pt';
  document.documentElement.dir = 'ltr';
  document.documentElement.dataset.language = state.language;
  document.documentElement.dataset.locale = state.locale;
}

const stored = readStored();
const initialLanguage = validLanguage(stored.language) || browserLanguage();
const initialDefaults = LANGUAGE_DEFAULTS[initialLanguage];
const initial = {
  language: initialLanguage,
  locale: validLocale(stored.locale) || browserLocale(initialLanguage) || initialDefaults.locale,
  currency: validCurrency(stored.currency) || initialDefaults.currency,
  timeZone: isValidTimeZone(stored.timeZone) ? stored.timeZone : browserTimeZone(),
  countryCode: /^[A-Z]{2}$/.test(stored.countryCode || '') ? stored.countryCode : null,
  preferenceMode: stored.preferenceMode === 'manual' ? 'manual' : 'auto',
  detectionCompleted: stored.detectionCompleted === true,
};
applyDocumentMetadata(initial);

export const useLocaleStore = create((set, get) => ({
  ...initial,
  initialized: false,
  detecting: false,

  async initialize({ force = false } = {}) {
    const current = get();
    if (current.initialized && !force) return current;
    if ((current.preferenceMode === 'manual' || current.detectionCompleted) && !force) {
      applyDocumentMetadata(current);
      set({ initialized: true, detecting: false });
      return get();
    }

    set({ detecting: true });
    const countryCode = await detectCountry();
    const detected = detectedPreferences(countryCode);
    const next = { ...get(), ...detected, preferenceMode: 'auto', detectionCompleted: true, initialized: true, detecting: false };
    persist(next);
    applyDocumentMetadata(next);
    set(next);
    return next;
  },

  async detectAutomatically() {
    set({ preferenceMode: 'auto', detectionCompleted: false });
    return get().initialize({ force: true });
  },

  setLanguage(language, { applySuggestedRegion = false } = {}) {
    if (!validLanguage(language)) return;
    set((state) => {
      const next = applySuggestedRegion
        ? { ...state, language, ...LANGUAGE_DEFAULTS[language], preferenceMode: 'manual' }
        : { ...state, language, preferenceMode: 'manual' };
      persist(next);
      applyDocumentMetadata(next);
      return next;
    });
  },

  setLocale(locale) {
    if (!validLocale(locale)) return;
    set((state) => {
      const next = { ...state, locale, preferenceMode: 'manual' };
      persist(next); applyDocumentMetadata(next); return next;
    });
  },

  setCurrency(currency) {
    if (!validCurrency(currency)) return;
    set((state) => {
      const next = { ...state, currency, preferenceMode: 'manual' };
      persist(next); return next;
    });
  },

  setTimeZone(timeZone) {
    if (!isValidTimeZone(timeZone)) return;
    set((state) => {
      const next = { ...state, timeZone, preferenceMode: 'manual' };
      persist(next); return next;
    });
  },

  applyPreferences(preferences = {}, { mode = 'manual' } = {}) {
    set((state) => {
      const language = validLanguage(preferences.language) || state.language;
      const next = {
        ...state,
        language,
        locale: validLocale(preferences.locale) || state.locale,
        currency: validCurrency(preferences.currency) || state.currency,
        timeZone: isValidTimeZone(preferences.timeZone) ? preferences.timeZone : state.timeZone,
        preferenceMode: mode,
      };
      persist(next); applyDocumentMetadata(next); return next;
    });
  },

  resetToLanguageDefaults() {
    set((state) => {
      const next = { ...state, ...LANGUAGE_DEFAULTS[state.language], preferenceMode: 'manual' };
      persist(next); applyDocumentMetadata(next); return next;
    });
  },
}));

export function getLocalePreferences() {
  const state = useLocaleStore.getState();
  return {
    language: state.language,
    locale: state.locale,
    currency: state.currency,
    timeZone: state.timeZone,
    countryCode: state.countryCode,
    preferenceMode: state.preferenceMode,
  };
}

export function getCurrencySymbol(currency = getLocalePreferences().currency, locale = getLocalePreferences().locale) {
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: 'currency', currency, currencyDisplay: 'narrowSymbol',
    }).formatToParts(0);
    return parts.find((part) => part.type === 'currency')?.value || currency;
  } catch {
    return currency;
  }
}
