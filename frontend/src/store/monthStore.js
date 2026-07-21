import { create } from 'zustand';
import { monthsApi } from '../lib/services';
import { useAuthStore } from './authStore';

// Guarda qual mês o usuário estava vendo por último, no navegador —
// escopado por usuário (getStorageKey) para não misturar a seleção de
// pessoas diferentes usando o mesmo navegador/computador.
function getStorageKey() {
  const userId = useAuthStore.getState().user?.id;
  return userId ? `financeiro:lastMonthId:${userId}` : null;
}

function persistSelection(monthId) {
  const key = getStorageKey();
  if (!key) return;
  try {
    localStorage.setItem(key, String(monthId));
  } catch {
    // localStorage pode falhar (modo privado, quota cheia) — não é motivo
    // para travar a troca de mês, só para não lembrar da próxima vez.
  }
}

function readPersistedSelection() {
  const key = getStorageKey();
  if (!key) return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export const useMonthStore = create((set, get) => ({
  months: [],
  selectedMonthId: null,
  status: 'idle',

  // Antes, `initialize()` SEMPRE definia o mês selecionado como "o mês de
  // hoje" (GET /months/current, resolvido pela data real do computador/
  // servidor) — então, mesmo que o usuário estivesse trabalhando em
  // outro mês (ex.: adiantando lançamentos, ou revendo um mês passado), ao
  // recarregar a página ou logar de novo, o app "puxava" de volta para a
  // data real do PC. Agora: restaura o ÚLTIMO mês visto (guardado no
  // navegador) e só cai para "hoje" se ainda não houver nada salvo (ex.:
  // primeiro acesso) ou se o mês salvo não existir mais na lista.
  async initialize() {
    set({ status: 'loading' });
    try {
      const list = await monthsApi.list();
      const chronological = [...(list.data.months ?? [])].sort((a, b) =>
        a.year === b.year ? a.month - b.month : a.year - b.year
      );

      const savedId = readPersistedSelection();
      const saved = savedId ? chronological.find((m) => String(m.id) === savedId) : null;

      if (saved) {
        set({ months: chronological, selectedMonthId: saved.id, status: 'ready' });
        return;
      }

      // Sem seleção salva (primeiro acesso) ou o mês salvo não existe mais
      // — só aqui recorremos à data real, como ponto de partida razoável
      // para quem está entrando pela primeira vez.
      const current = await monthsApi.current();
      const currentMonth = current.data.month;
      if (!chronological.some((m) => String(m.id) === String(currentMonth.id))) {
        chronological.push(currentMonth);
        chronological.sort((a, b) => (a.year === b.year ? a.month - b.month : a.year - b.year));
      }
      persistSelection(currentMonth.id);
      set({ months: chronological, selectedMonthId: currentMonth.id, status: 'ready' });
    } catch {
      set({ status: 'error' });
    }
  },

  // Recarrega só a LISTA de meses (ex.: depois de fechar um mês, que cria
  // o mês seguinte no banco) sem tocar em `selectedMonthId`. Existe
  // separado de `initialize()` de propósito: `initialize()` é para o
  // carregamento inicial do app; reusar `initialize()` depois de fechar um
  // mês reintroduziria o mesmo problema de "puxar a data real" que
  // acabamos de tirar do fluxo normal.
  async refreshMonths() {
    try {
      const list = await monthsApi.list();
      const chronological = [...(list.data.months ?? [])].sort((a, b) =>
        a.year === b.year ? a.month - b.month : a.year - b.year
      );
      set({ months: chronological });
      return chronological;
    } catch {
      return get().months;
    }
  },

  selectMonth(monthId) {
    persistSelection(monthId);
    set({ selectedMonthId: monthId });
  },

  goToAdjacent(direction) {
    const { months, selectedMonthId } = get();
    const index = months.findIndex((m) => String(m.id) === String(selectedMonthId));
    const next = index + direction;
    if (next < 0 || next >= months.length) return;
    get().selectMonth(months[next].id);
  },

  getSelectedMonth() {
    const { months, selectedMonthId } = get();
    return months.find((m) => String(m.id) === String(selectedMonthId)) ?? null;
  },
}));
