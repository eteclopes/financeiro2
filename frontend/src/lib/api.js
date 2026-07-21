import axios from 'axios';
import { getAccessToken, setAccessToken } from './tokenStore';

const baseURL = import.meta.env.VITE_API_URL ?? 'http://localhost:3333/api';

export const api = axios.create({
  baseURL,
  withCredentials: true, // necessário para o cookie httpOnly do refresh token
});

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let refreshPromise = null;

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const isAuthRoute = original?.url?.includes('/auth/');

    // Só tenta refresh uma vez por requisição (evita loop infinito) e nunca
    // nas próprias rotas de auth (login errado não deve disparar refresh).
    if (error.response?.status === 401 && !original._retry && !isAuthRoute) {
      original._retry = true;
      try {
        refreshPromise = refreshPromise ?? api.post('/auth/refresh');
        const { data } = await refreshPromise;
        refreshPromise = null;
        setAccessToken(data.accessToken);
        original.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(original);
      } catch (refreshError) {
        refreshPromise = null;
        setAccessToken(null);
        window.dispatchEvent(new CustomEvent('auth:session-expired'));
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export function extractErrorMessage(error, fallback = 'Algo deu errado. Tente novamente.') {
  return error?.response?.data?.error?.message ?? fallback;
}

// O backend, quando a validação (Zod) falha, retorna
// `error.details = { campo: ['mensagem 1', 'mensagem 2'] }` (código 422).
// Este helper extrai isso num formato fácil de usar nos formulários:
// `{ campo: 'mensagem 1' }` — pega só a primeira mensagem de cada campo.
export function extractFieldErrors(error) {
  const details = error?.response?.data?.error?.details;
  if (!details || typeof details !== 'object') return {};
  return Object.fromEntries(
    Object.entries(details)
      .filter(([, messages]) => Array.isArray(messages) && messages.length > 0)
      .map(([field, messages]) => [field, messages[0]])
  );
}
