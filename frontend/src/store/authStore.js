import { create } from 'zustand';
import { api, extractErrorMessage, extractFieldErrors, refreshAccessToken } from '../lib/api';
import { setAccessToken } from '../lib/tokenStore';
import { writeActiveWorkspaceId } from '../lib/workspaceStorage';

// Pista NÃO sensível de que havia uma sessão. Não é o token — é só um
// booleano. Serve para, ao recarregar a aba (o navegador descarta abas em
// segundo plano, sobretudo no celular), o app já renderizar como logado e
// revalidar a sessão em silêncio, em vez de piscar uma tela cheia de
// "Preparando seu painel" a cada retorno. O token continua só na memória.
const SESSION_HINT_KEY = 'fh_session';

function readSessionHint() {
  try { return localStorage.getItem(SESSION_HINT_KEY) === '1'; }
  catch { return false; }
}

function writeSessionHint(active) {
  try {
    if (active) localStorage.setItem(SESSION_HINT_KEY, '1');
    else localStorage.removeItem(SESSION_HINT_KEY);
  } catch { /* modo privado / quota cheia — sem problema */ }
}

export const useAuthStore = create((set) => ({
  user: null,
  // Começa otimista quando já houve sessão: a aba renderiza o app na hora e
  // o refresh acontece no fundo (bootstrapping). Sem pista, é login normal.
  status: readSessionHint() ? 'authenticated' : 'idle',
  bootstrapping: false,
  error: null,
  fieldErrors: {},

  async bootstrap() {
    const hadSession = readSessionHint();
    // Com sessão prévia, NÃO trocamos para 'loading' (isso apagaria a tela).
    // Mantemos o app renderizado e revalidamos por baixo.
    set(hadSession
      ? { status: 'authenticated', bootstrapping: true }
      : { status: 'loading', bootstrapping: true });
    try {
      await refreshAccessToken();
      const { data: meData } = await api.get('/auth/me');
      writeSessionHint(true);
      set({ user: meData.user, status: 'authenticated', bootstrapping: false, error: null });
    } catch {
      setAccessToken(null);
      writeSessionHint(false);
      set({ user: null, status: 'unauthenticated', bootstrapping: false });
    }
  },

  async login(email, password) {
    set({ status: 'loading', error: null, fieldErrors: {} });
    try {
      const { data } = await api.post('/auth/login', { email, password });
      setAccessToken(data.accessToken);
      writeActiveWorkspaceId('real');
      writeSessionHint(true);
      set({ user: data.user, status: 'authenticated', bootstrapping: false, error: null });
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
      writeActiveWorkspaceId('real');
      writeSessionHint(true);
      set({ user: data.user, status: 'authenticated', bootstrapping: false, error: null });
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
    writeActiveWorkspaceId('real');
    writeSessionHint(false);
    set({ user: null, status: 'unauthenticated', bootstrapping: false, error: null });
  },

  // Encerra a sessão em TODOS os dispositivos (revoga a família inteira de
  // refresh tokens no backend). Útil após suspeita de token comprometido.
  async logoutAllDevices() {
    try { await api.post('/auth/logout-all'); } catch {}
    setAccessToken(null);
    writeActiveWorkspaceId('real');
    writeSessionHint(false);
    set({ user: null, status: 'unauthenticated', bootstrapping: false, error: null });
  },

  acceptRefreshedIdentity(user) {
    if (!user) return;
    set({ user, status: 'authenticated', error: null });
  },

  forceSignOut() {
    setAccessToken(null);
    writeActiveWorkspaceId('real');
    writeSessionHint(false);
    set({ user: null, status: 'unauthenticated', bootstrapping: false });
  },

  clearError() { set({ error: null, fieldErrors: {} }); },
}));
