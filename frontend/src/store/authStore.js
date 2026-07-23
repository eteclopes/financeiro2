import { create } from 'zustand';
import { api, extractErrorMessage, extractFieldErrors, refreshAccessToken } from '../lib/api';
import { setAccessToken } from '../lib/tokenStore';

export const useAuthStore = create((set) => ({
  user: null,
  status: 'idle',
  error: null,
  fieldErrors: {},

  async bootstrap() {
    set({ status: 'loading' });
    try {
      await refreshAccessToken();
      const { data: meData } = await api.get('/auth/me');
      set({ user: meData.user, status: 'authenticated', error: null });
    } catch {
      setAccessToken(null);
      set({ user: null, status: 'unauthenticated' });
    }
  },

  async login(email, password) {
    set({ status: 'loading', error: null, fieldErrors: {} });
    try {
      const { data } = await api.post('/auth/login', { email, password });
      setAccessToken(data.accessToken);
      set({ user: data.user, status: 'authenticated', error: null });
      return true;
    } catch (error) {
      set({
        status: 'unauthenticated',
        error: extractErrorMessage(error, 'E-mail ou senha inválidos.'),
        fieldErrors: extractFieldErrors(error),
      });
      return false;
    }
  },

  async register(name, email, password) {
    set({ status: 'loading', error: null, fieldErrors: {} });
    try {
      const { data } = await api.post('/auth/register', { name, email, password });
      setAccessToken(data.accessToken);
      set({ user: data.user, status: 'authenticated', error: null });
      return true;
    } catch (error) {
      set({
        status: 'unauthenticated',
        error: extractErrorMessage(error, 'Não foi possível criar a conta.'),
        fieldErrors: extractFieldErrors(error),
      });
      return false;
    }
  },

  async updateProfile(name) {
    const { data } = await api.patch('/auth/me', { name });
    set((state) => ({ user: { ...state.user, ...data.user } }));
    return data.user;
  },

  async reloadUser() {
    const { data } = await api.get('/auth/me');
    set({ user: data.user, status: 'authenticated', error: null });
    return data.user;
  },

  async logout() {
    try { await api.post('/auth/logout'); } catch {}
    setAccessToken(null);
    set({ user: null, status: 'unauthenticated', error: null });
  },

  forceSignOut() {
    setAccessToken(null);
    set({ user: null, status: 'unauthenticated' });
  },

  clearError() { set({ error: null, fieldErrors: {} }); },
}));
