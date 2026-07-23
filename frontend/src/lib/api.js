import axios from 'axios';
import { getAccessToken, setAccessToken } from './tokenStore';
import { getLocalePreferences } from '../store/localeStore';

const DEFAULT_API_URL = import.meta.env.PROD
  ? 'https://financeiro2-8kgt.onrender.com/api'
  : 'http://localhost:3333/api';

// Aceita tanto `https://backend.exemplo.com` quanto
// `https://backend.exemplo.com/api`. Isso evita 404 em produção quando a
// variável VITE_API_URL é cadastrada no provedor apenas com o domínio.
export function normalizeApiBaseURL(rawURL) {
  const normalized = String(rawURL || DEFAULT_API_URL).trim().replace(/\/+$/, '');
  return /\/api$/i.test(normalized) ? normalized : `${normalized}/api`;
}

const baseURL = normalizeApiBaseURL(import.meta.env.VITE_API_URL);

export const api = axios.create({
  baseURL,
  withCredentials: true, // necessário para o cookie httpOnly do refresh token
});

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  const preferences = getLocalePreferences();
  config.headers['Accept-Language'] = preferences.locale || preferences.language;
  config.headers['X-Time-Zone'] = preferences.timeZone;
  config.headers['X-Currency'] = preferences.currency;
  return config;
});

let refreshPromise = null;

// Único ponto de renovação da sessão dentro da página. Bootstrap e
// interceptador compartilham a mesma Promise, impedindo rajadas de refresh.
export function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = api.post('/auth/refresh')
      .then(({ data }) => {
        setAccessToken(data.accessToken);
        return data.accessToken;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

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
        const accessToken = await refreshAccessToken();
        original.headers.Authorization = `Bearer ${accessToken}`;
        return api(original);
      } catch (refreshError) {
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
