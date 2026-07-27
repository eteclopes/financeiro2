#!/usr/bin/env node
'use strict';

/**
 * Gera material de chave para a camada de criptografia.
 *
 *   node scripts/generate-encryption-keys.js
 *
 * As chaves são impressas UMA vez e não ficam gravadas em lugar nenhum.
 * Copie para o gerenciador de segredos do provedor (Render → Environment) e
 * guarde uma cópia de emergência fora dele. Perder a KEK significa perder
 * definitivamente o acesso a todo texto criptografado — não existe recuperação.
 */

const crypto = require('node:crypto');

const key = () => crypto.randomBytes(32).toString('base64');

console.log(`
# ─────────────────────────────────────────────────────────────
# Chaves de criptografia — FinançasHub
# Geradas em ${new Date().toISOString()}
#
# ATENÇÃO
#  - Nunca versione estes valores no Git.
#  - Nunca envie ao frontend.
#  - Guarde uma cópia offline: sem a KEK, os dados são irrecuperáveis.
#  - Ao rotacionar, ADICIONE a nova versão e mantenha a antiga até o
#    re-embrulho de todas as DEKs terminar.
# ─────────────────────────────────────────────────────────────

DATA_KEK_V1=${key()}
DATA_KEK_CURRENT_VERSION=1

EMAIL_LOOKUP_KEY_V1=${key()}
EMAIL_LOOKUP_CURRENT_VERSION=1

# Deixe como 'false' durante a migração em fases. Depois que o backfill
# terminar e for validado, mude para 'true' para que a aplicação se recuse a
# subir sem chaves (evita voltar a gravar texto puro por engano).
ENCRYPTION_REQUIRED=false
`);
