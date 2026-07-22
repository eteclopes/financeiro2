import { useId } from 'react';
import { LANGUAGE_META } from '../i18n/translations.js';
import { LANGUAGE_OPTIONS, useLocaleStore } from '../store/localeStore.js';

export function LocaleSwitcher({ compact = false, className = '' }) {
  const id = useId();
  const language = useLocaleStore((state) => state.language);
  const setLanguage = useLocaleStore((state) => state.setLanguage);

  if (compact) {
    return (
      <label className={`relative grid h-10 min-w-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition-all hover:border-primary/30 hover:text-primary dark:border-white/[0.07] dark:bg-white/[0.035] dark:text-zinc-300 ${className}`} title="Idioma">
        <span aria-hidden="true" className="pointer-events-none text-[11px] font-black tracking-wide">{LANGUAGE_META[language]?.shortName ?? 'PT'}</span>
        <span className="sr-only">Idioma</span>
        <select
          id={id}
          aria-label="Idioma"
          value={language}
          onChange={(event) => setLanguage(event.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        >
          {LANGUAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.nativeLabel}</option>)}
        </select>
      </label>
    );
  }

  return (
    <label htmlFor={id} className={`block ${className}`}>
      <span className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-zinc-200">Idioma</span>
      <select
        id={id}
        value={language}
        onChange={(event) => setLanguage(event.target.value)}
        className="input-base w-full"
      >
        {LANGUAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.nativeLabel}</option>)}
      </select>
    </label>
  );
}
