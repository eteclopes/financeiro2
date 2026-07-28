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

let refreshPromise = null;

const baseURL = normalizeApiBaseURL(import.meta.env.VITE_API_URL);

export const api = axios.create({
  baseURL,
  withCredentials: true, // necessário para o cookie httpOnly do refresh token
});

api.interceptors.request.use(async (config) => {
  const isAuthRoute = config.url?.includes('/auth/');

  // Se há uma renovação de sessão em andamento, espera por ela ANTES de ler
  // o token. No arranque (e ao voltar para a aba) o app dispara várias cargas
  // em paralelo enquanto o refresh ainda está no ar: sem esta espera todas
  // saíam sem token, tomavam 401 e só então eram repetidas — funcionava, mas
  // enchia o console de erro e batia no servidor duas vezes.
  //
  // A espera fica AQUI, no mesmo interceptador que anexa o cabeçalho, de
  // propósito: separar em dois passaria a depender da ordem de execução dos
  // interceptadores do axios, que é o inverso da ordem de registro.
  if (!isAuthRoute && refreshPromise) {
    try { await refreshPromise; } catch { /* o interceptador de resposta trata */ }
  }

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

/**
 * Espera curta usada na retentativa de falha de rede.
 */
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const isAuthRoute = original?.url?.includes('/auth/');

    // ── FALHA DE REDE (ERR_CONNECTION_CLOSED, timeout, servidor dormindo) ──
    //
    // `error.response` ausente significa que a resposta nunca chegou. No plano
    // gratuito do Render o serviço hiberna, e a primeira chamada depois de um
    // tempo ocioso costuma morrer enquanto a instância acorda. Uma retentativa
    // curta resolve isso sem o usuário ver erro.
    //
    // A retentativa é SÓ para GET. Repetir um POST cuja resposta se perdeu
    // poderia pagar a mesma conta duas vezes — o pedido pode ter chegado ao
    // servidor e sido processado antes da conexão cair.
    const isNetworkError = !error.response && error.code !== 'ERR_CANCELED';
    const isIdempotent = (original?.method ?? 'get').toLowerCase() === 'get';
    if (isNetworkError && isIdempotent && !original._netRetry) {
      original._netRetry = true;
      await wait(700);
      return api(original);
    }

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
