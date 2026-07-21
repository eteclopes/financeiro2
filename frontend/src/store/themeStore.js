import { create } from 'zustand';

const STORAGE_KEY = 'financaspro:theme';

function getInitialTheme() {
  if (typeof window === 'undefined') return 'light';
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === 'dark' || saved === 'light') return saved;
  // Primeira visita (nada salvo ainda): respeita a preferência do sistema.
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}

function applyThemeClass(theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

// Aplica imediatamente no carregamento do módulo (antes do primeiro render),
// para não haver "flash" de light mode antes do React montar.
const initialTheme = getInitialTheme();
applyThemeClass(initialTheme);

export const useThemeStore = create((set, get) => ({
  theme: initialTheme,

  setTheme(theme) {
    window.localStorage.setItem(STORAGE_KEY, theme);
    applyThemeClass(theme);
    set({ theme });
  },

  toggleTheme() {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    get().setTheme(next);
  },
}));