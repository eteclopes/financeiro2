'use strict';

/**
 * CAMADA CENTRAL DE CRIPTOGRAFIA — FinançasHub
 * ============================================
 *
 * Objetivo: quem abrir o PostgreSQL não deve conseguir identificar pessoas
 * nem ler os textos que elas escreveram. Valores monetários permanecem em
 * claro, como Decimal, porque o sistema soma, filtra e projeta em cima deles.
 *
 * ARQUITETURA (criptografia por envelope)
 * ---------------------------------------
 *
 *   KEK  (Key Encryption Key, fora do banco, versionada)
 *     │
 *     │  protege (AES-256-GCM, AAD amarrada ao usuário)
 *     ▼
 *   DEK  (Data Encryption Key — uma por usuário, guardada só embrulhada)
 *     │
 *     │  criptografa (AES-256-GCM, nonce novo a cada operação)
 *     ▼
 *   nome, e-mail, descrições, observações, notas
 *
 * Por que uma DEK por usuário: vazar o registro de um usuário não ajuda a ler
 * o de outro, e a rotação de chave de uma conta não obriga reescrever o banco
 * inteiro. Trocar a KEK re-embrulha apenas as DEKs (uma linha por usuário),
 * sem tocar em nenhum texto criptografado.
 *
 * FORMATOS
 * --------
 *   Campo:     enc:v1:<nonce_b64>:<ciphertext_b64>:<authTag_b64>
 *   DEK:       dek:v1:<kekVersion>:<nonce_b64>:<ciphertext_b64>:<authTag_b64>
 *   Lookup:    hml:v1:<hmac_hex>          (HMAC-SHA-256 do e-mail normalizado)
 *
 * COMPATIBILIDADE DURANTE A MIGRAÇÃO
 * ----------------------------------
 * `decryptForUser` devolve o valor como está quando ele NÃO é um envelope.
 * Isso é o que permite o deploy em fases exigido pelo plano: o código novo lê
 * tanto o dado antigo (texto puro) quanto o novo (criptografado), e o backfill
 * pode rodar depois, sem janela de indisponibilidade.
 */

const crypto = require('node:crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;   // AES-256
const NONCE_BYTES = 12; // 96 bits — tamanho recomendado para GCM
const TAG_BYTES = 16;

const FIELD_PREFIX = 'enc';
const DEK_PREFIX = 'dek';
const LOOKUP_PREFIX = 'hml';
const CURRENT_FORMAT = 'v1';

// ─────────────────────────────────────────────────────────────────────────
// Carregamento de chaves
// ─────────────────────────────────────────────────────────────────────────

/**
 * As chaves vêm SEMPRE do ambiente e nunca do banco, do código ou de uma
 * resposta HTTP. Cada uma é versionada para permitir rotação sem downtime:
 * o dado antigo continua legível pela versão com que foi escrito.
 *
 *   DATA_KEK_V1=<32 bytes em base64 ou hex>
 *   DATA_KEK_V2=...                        (ao rotacionar)
 *   DATA_KEK_CURRENT_VERSION=1
 *   EMAIL_LOOKUP_KEY_V1=<32 bytes>
 *   EMAIL_LOOKUP_CURRENT_VERSION=1
 */
function parseKeyMaterial(raw, label) {
  if (!raw) return null;
  const value = String(raw).trim();
  let buf;
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    buf = Buffer.from(value, 'hex');
  } else {
    buf = Buffer.from(value, 'base64');
  }
  if (buf.length !== KEY_BYTES) {
    throw new Error(`${label} precisa ter exatamente ${KEY_BYTES} bytes (256 bits).`);
  }
  return buf;
}

function collectVersionedKeys(prefix, label) {
  const keys = new Map();
  for (const [name, value] of Object.entries(process.env)) {
    const match = name.match(new RegExp(`^${prefix}_V(\\d+)$`));
    if (!match) continue;
    keys.set(Number(match[1]), parseKeyMaterial(value, name));
  }
  if (keys.size === 0) return { keys, current: null };

  const declared = process.env[`${prefix}_CURRENT_VERSION`];
  const current = declared ? Number(declared) : Math.max(...keys.keys());
  if (!keys.has(current)) {
    throw new Error(`${label}: versão atual ${current} não tem chave configurada.`);
  }
  return { keys, current };
}

let cache = null;

function keyring() {
  if (cache) return cache;

  const kek = collectVersionedKeys('DATA_KEK', 'KEK de dados');
  const lookup = collectVersionedKeys('EMAIL_LOOKUP_KEY', 'Chave de lookup de e-mail');

  const enabled = kek.current !== null && lookup.current !== null;

  // Em produção é possível exigir que a criptografia esteja obrigatoriamente
  // ativa. Durante a migração em fases isso fica desligado de propósito: sem
  // chaves, o sistema opera como hoje (texto puro) e nada quebra.
  if (!enabled && process.env.ENCRYPTION_REQUIRED === 'true') {
    throw new Error(
      'ENCRYPTION_REQUIRED=true mas as chaves não estão configuradas. '
      + 'Defina DATA_KEK_V1 e EMAIL_LOOKUP_KEY_V1.'
    );
  }

  cache = { kek, lookup, enabled };
  return cache;
}

/** Zera o cache de chaves. Usado por testes e após rotação em runtime. */
function resetKeyringCache() { cache = null; }

/** A criptografia está ativa? Falso = modo compatível (texto puro). */
function isEncryptionEnabled() { return keyring().enabled; }

function requireEnabled(operation) {
  if (!keyring().enabled) {
    const err = new Error(`Criptografia não configurada; ${operation} indisponível.`);
    err.code = 'ENCRYPTION_NOT_CONFIGURED';
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Primitivas
// ─────────────────────────────────────────────────────────────────────────

function b64(buf) { return buf.toString('base64'); }
function unb64(str) { return Buffer.from(str, 'base64'); }

/**
 * AAD (dados autenticados adicionais) amarra o texto cifrado ao seu contexto.
 * Sem isso, alguém com acesso ao banco poderia MOVER um valor criptografado
 * de um registro para outro — a decifragem continuaria funcionando. Com AAD,
 * mover o dado invalida a tag e a leitura falha.
 */
function sealWithKey(key, plaintext, aad) {
  const nonce = crypto.randomBytes(NONCE_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES });
  if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
  return { nonce, ciphertext, tag: cipher.getAuthTag() };
}

function openWithKey(key, nonce, ciphertext, tag, aad) {
  const decipher = crypto.createDecipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES });
  if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// ─────────────────────────────────────────────────────────────────────────
// Envelopes
// ─────────────────────────────────────────────────────────────────────────

/** Reconhece um envelope de campo. Validação estrita: formato errado = false. */
function isEncryptedEnvelope(value) {
  if (typeof value !== 'string') return false;
  const parts = value.split(':');
  if (parts.length !== 5) return false;
  const [prefix, version, nonce, ciphertext, tag] = parts;
  if (prefix !== FIELD_PREFIX || !/^v\d+$/.test(version)) return false;
  try {
    return unb64(nonce).length === NONCE_BYTES
      && unb64(tag).length === TAG_BYTES
      && ciphertext.length > 0;
  } catch { return false; }
}

function parseEnvelope(value, expectedPrefix) {
  if (typeof value !== 'string') throw envelopeError();
  const parts = value.split(':');
  const isDek = expectedPrefix === DEK_PREFIX;
  const expectedLength = isDek ? 6 : 5;
  if (parts.length !== expectedLength) throw envelopeError();

  const prefix = parts[0];
  const version = parts[1];
  if (prefix !== expectedPrefix) throw envelopeError();
  if (version !== CURRENT_FORMAT) {
    // Versões futuras são reconhecidas mas exigem código que as entenda.
    const err = new Error(`Formato de envelope não suportado: ${version}`);
    err.code = 'UNSUPPORTED_ENVELOPE_VERSION';
    throw err;
  }

  const offset = isDek ? 1 : 0;
  const keyVersion = isDek ? Number(parts[2]) : null;
  const nonce = unb64(parts[2 + offset]);
  const ciphertext = unb64(parts[3 + offset]);
  const tag = unb64(parts[4 + offset]);

  if (nonce.length !== NONCE_BYTES || tag.length !== TAG_BYTES || ciphertext.length === 0) {
    throw envelopeError();
  }
  return { keyVersion, nonce, ciphertext, tag };
}

function envelopeError() {
  const err = new Error('Envelope criptográfico inválido.');
  err.code = 'INVALID_ENVELOPE';
  return err;
}

// ─────────────────────────────────────────────────────────────────────────
// DEK por usuário
// ─────────────────────────────────────────────────────────────────────────

/** Gera uma DEK nova (32 bytes aleatórios). Nunca é persistida em claro. */
function generateUserDataKey() {
  return crypto.randomBytes(KEY_BYTES);
}

function dekAad(userId) {
  // Amarra a DEK embrulhada ao usuário: copiar a coluna para outra conta
  // não permite abrir os dados daquela conta.
  return `${DEK_PREFIX}:${CURRENT_FORMAT}:user:${String(userId)}`;
}

/** Embrulha a DEK com a KEK atual. Devolve a string a guardar no banco. */
function wrapUserDataKey(dataKey, userId) {
  requireEnabled('embrulhar chave de usuário');
  if (!Buffer.isBuffer(dataKey) || dataKey.length !== KEY_BYTES) {
    throw new Error('DEK inválida.');
  }
  const { kek } = keyring();
  const kekKey = kek.keys.get(kek.current);
  const { nonce, ciphertext, tag } = sealWithKey(kekKey, dataKey.toString('base64'), dekAad(userId));
  return [DEK_PREFIX, CURRENT_FORMAT, String(kek.current), b64(nonce), b64(ciphertext), b64(tag)].join(':');
}

/** Desembrulha a DEK. Aceita qualquer versão de KEK ainda configurada. */
function unwrapUserDataKey(wrapped, userId) {
  requireEnabled('desembrulhar chave de usuário');
  const { keyVersion, nonce, ciphertext, tag } = parseEnvelope(wrapped, DEK_PREFIX);
  const { kek } = keyring();
  const kekKey = kek.keys.get(keyVersion);
  if (!kekKey) {
    const err = new Error(`KEK versão ${keyVersion} não está configurada.`);
    err.code = 'KEK_VERSION_UNAVAILABLE';
    throw err;
  }
  const raw = openWithKey(kekKey, nonce, ciphertext, tag, dekAad(userId));
  return Buffer.from(raw, 'base64');
}

/**
 * Rotação: re-embrulha a DEK com a KEK atual sem tocar em nenhum texto.
 * Devolve null quando já está na versão corrente (nada a fazer).
 */
function rotateUserDataKey(wrapped, userId) {
  const { keyVersion } = parseEnvelope(wrapped, DEK_PREFIX);
  const { kek } = keyring();
  if (keyVersion === kek.current) return null;
  const dataKey = unwrapUserDataKey(wrapped, userId);
  return wrapUserDataKey(dataKey, userId);
}

// ─────────────────────────────────────────────────────────────────────────
// Campos
// ─────────────────────────────────────────────────────────────────────────

function encryptWithDataKey(dataKey, plaintext, aad) {
  if (plaintext === null || plaintext === undefined || plaintext === '') return plaintext;
  const { nonce, ciphertext, tag } = sealWithKey(dataKey, String(plaintext), aad);
  return [FIELD_PREFIX, CURRENT_FORMAT, b64(nonce), b64(ciphertext), b64(tag)].join(':');
}

function decryptWithDataKey(dataKey, value, aad) {
  if (value === null || value === undefined || value === '') return value;

  // Um valor que NÃO começa com o prefixo é dado legado, ainda não migrado:
  // devolve como está (é isso que viabiliza o deploy em fases).
  if (typeof value !== 'string' || !value.startsWith(`${FIELD_PREFIX}:`)) return value;

  // A partir daqui o valor se apresenta como criptografado. Se estiver
  // malformado, é corrupção ou adulteração — nunca um texto legado. Devolver
  // a string crua nesse caso mostraria lixo ao usuário e esconderia o
  // problema; falhar alto é o comportamento correto.
  if (!isEncryptedEnvelope(value)) throw envelopeError();

  const { nonce, ciphertext, tag } = parseEnvelope(value, FIELD_PREFIX);
  return openWithKey(dataKey, nonce, ciphertext, tag, aad);
}

/** Conveniência: recebe a DEK embrulhada e cuida de desembrulhar. */
function encryptForUser(wrappedDataKey, userId, plaintext, aad) {
  if (!isEncryptionEnabled()) return plaintext; // modo compatível
  const dataKey = unwrapUserDataKey(wrappedDataKey, userId);
  return encryptWithDataKey(dataKey, plaintext, aad);
}

function decryptForUser(wrappedDataKey, userId, value, aad) {
  if (!isEncryptedEnvelope(value)) return value; // texto puro legado
  const dataKey = unwrapUserDataKey(wrappedDataKey, userId);
  return decryptWithDataKey(dataKey, value, aad);
}

// ─────────────────────────────────────────────────────────────────────────
// E-mail pesquisável
// ─────────────────────────────────────────────────────────────────────────

/**
 * Normalização única, usada em cadastro, login, recuperação e busca. Se cada
 * fluxo normalizar de um jeito, o mesmo e-mail gera lookups diferentes e o
 * login quebra. Não mexemos na parte local além de aparar e minusculizar:
 * remover pontos ou sufixos "+" trataria endereços distintos como iguais.
 */
function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

/**
 * Índice de busca por e-mail: HMAC-SHA-256 com chave dedicada, diferente da
 * KEK. HMAC (e não SHA-256 puro) porque sem a chave ninguém consegue montar
 * um dicionário de e-mails conhecidos e casar com a coluna.
 */
function createEmailLookup(email) {
  requireEnabled('lookup de e-mail');
  const { lookup } = keyring();
  const key = lookup.keys.get(lookup.current);
  const mac = crypto.createHmac('sha256', key).update(normalizeEmail(email), 'utf8').digest('hex');
  return `${LOOKUP_PREFIX}:${CURRENT_FORMAT}:${mac}`;
}

/** Lookups de todas as versões configuradas — usado durante a rotação. */
function createEmailLookupCandidates(email) {
  const { lookup } = keyring();
  const normalized = normalizeEmail(email);
  return [...lookup.keys.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, key]) =>
      `${LOOKUP_PREFIX}:${CURRENT_FORMAT}:${crypto.createHmac('sha256', key).update(normalized, 'utf8').digest('hex')}`);
}

// ─────────────────────────────────────────────────────────────────────────
// Máscaras (para telas administrativas e logs)
// ─────────────────────────────────────────────────────────────────────────

function maskEmail(email) {
  const input = normalizeEmail(email);
  const [local, domain] = input.split('@');
  if (!local || !domain) return '[e-mail oculto]';
  return `${local.slice(0, 1)}${'*'.repeat(Math.min(Math.max(local.length - 1, 3), 8))}@${domain}`;
}

function maskName(name) {
  const input = String(name ?? '').trim();
  if (!input) return '[nome oculto]';
  return input
    .split(/\s+/)
    .map((part, index) => (index === 0 ? part : `${part.slice(0, 1)}.`))
    .join(' ');
}

module.exports = {
  // estado
  isEncryptionEnabled,
  resetKeyringCache,
  // DEK
  generateUserDataKey,
  wrapUserDataKey,
  unwrapUserDataKey,
  rotateUserDataKey,
  // campos
  encryptWithDataKey,
  decryptWithDataKey,
  encryptForUser,
  decryptForUser,
  isEncryptedEnvelope,
  // e-mail
  normalizeEmail,
  createEmailLookup,
  createEmailLookupCandidates,
  // máscaras
  maskEmail,
  maskName,
  // constantes úteis a testes e scripts
  KEY_BYTES,
};
