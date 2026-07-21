import { create } from 'zustand';
import { useAuthStore } from './authStore';

// Guarda se o usuário já viu o tutorial, escopado por usuário (mesmo
// padrão de monthStore.js — evita marcar "já visto" pra todo mundo que usa
// o mesmo navegador).
function getStorageKey() {
  const userId = useAuthStore.getState().user?.id;
  return userId ? `financeiro:hasSeenTutorial:${userId}` : null;
}

function readHasSeenTutorial() {
  const key = getStorageKey();
  if (!key) return true; // sem usuário logado ainda, não decide nada
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return true; // se localStorage falhar, não força o tutorial em quem já devia ter visto
  }
}

function persistHasSeenTutorial() {
  const key = getStorageKey();
  if (!key) return;
  try { localStorage.setItem(key, '1'); } catch { /* modo privado etc. — sem problema, só não lembra da próxima vez */ }
}

export const useTutorialStore = create((set, get) => ({
  running: false,
  requested: false,
  stepIndex: 0,

  hasSeenTutorial: () => readHasSeenTutorial(),

  request() {
    set({ requested: true, running: false, stepIndex: 0 });
  },

  start() {
    set({ requested: false, running: true, stepIndex: 0 });
  },

  finish() {
    persistHasSeenTutorial();
    set({ requested: false, running: false, stepIndex: 0 });
  },

  skip() {
    persistHasSeenTutorial();
    set({ requested: false, running: false, stepIndex: 0 });
  },

  // Interrompe sem marcar como visto. Usado quando a página não conseguiu
  // carregar a tempo; assim o usuário pode tentar novamente depois.
  cancel() {
    set({ requested: false, running: false, stepIndex: 0 });
  },

  setStepIndex(i) {
    set({ stepIndex: i });
  },
}));
