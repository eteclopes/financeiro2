import { create } from 'zustand';
import { workspacesApi } from '../lib/services';
import { extractErrorMessage } from '../lib/api';
import { readActiveWorkspaceId, writeActiveWorkspaceId } from '../lib/workspaceStorage';
import { useMonthStore } from './monthStore';

const REAL = { id: 'real', type: 'real', name: 'Financeiro real' };

export const useWorkspaceStore = create((set, get) => ({
  status: 'idle',
  real: REAL,
  simulations: [],
  activeId: readActiveWorkspaceId(),
  error: null,

  async initialize() {
    set({ status: 'loading', error: null });
    try {
      const { data } = await workspacesApi.list();
      const simulations = data.simulations ?? [];
      const saved = readActiveWorkspaceId();
      const valid = saved === 'real' || simulations.some((item) => String(item.id) === String(saved));
      const activeId = writeActiveWorkspaceId(valid ? saved : 'real');
      set({
        status: 'ready',
        real: data.real ?? REAL,
        simulations,
        activeId,
      });
      return activeId;
    } catch (error) {
      writeActiveWorkspaceId('real');
      set({ status: 'error', activeId: 'real', error: extractErrorMessage(error, 'Não foi possível carregar os ambientes.') });
      return 'real';
    }
  },

  async switchWorkspace(id) {
    const normalized = writeActiveWorkspaceId(id);
    set({ activeId: normalized });
    useMonthStore.getState().reset();
    await useMonthStore.getState().initialize();
  },

  async createWorkspace(payload) {
    const { data } = await workspacesApi.create(payload);
    set((state) => ({ simulations: [...state.simulations, data.workspace] }));
    await get().switchWorkspace(data.workspace.id);
    return data.workspace;
  },

  async renameWorkspace(id, name) {
    const { data } = await workspacesApi.rename(id, name);
    set((state) => ({
      simulations: state.simulations.map((item) => String(item.id) === String(id) ? data.workspace : item),
    }));
    return data.workspace;
  },

  async deleteWorkspace(id) {
    if (String(get().activeId) === String(id)) await get().switchWorkspace('real');
    await workspacesApi.delete(id);
    set((state) => ({ simulations: state.simulations.filter((item) => String(item.id) !== String(id)) }));
  },

  getActiveWorkspace() {
    const { activeId, real, simulations } = get();
    return activeId === 'real'
      ? real
      : simulations.find((item) => String(item.id) === String(activeId)) ?? real;
  },

  isSimulation() {
    return get().activeId !== 'real';
  },
}));
