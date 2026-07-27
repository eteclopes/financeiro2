# Camada de privacidade e segurança — FinançasHub

Estado: **Fase 1 concluída** (fundação criptográfica). Fases 2 a 5 pendentes.

---

## 1. Arquitetura de criptografia

```
   ┌─────────────────────────────────────────────────────────┐
   │  KEK — Key Encryption Key                               │
   │  • vive só na variável de ambiente (Render)             │
   │  • versionada: DATA_KEK_V1, V2, ...                     │
   │  • nunca no banco, no código, em log ou no frontend     │
   └───────────────────────┬─────────────────────────────────┘
                           │ AES-256-GCM
                           │ AAD = "dek:v1:user:<userId>"
                           ▼
   ┌─────────────────────────────────────────────────────────┐
   │  DEK — uma por usuário                                  │
   │  • 32 bytes aleatórios                                  │
   │  • guardada SÓ embrulhada, na coluna encrypted_data_key │
   └───────────────────────┬─────────────────────────────────┘
                           │ AES-256-GCM
                           │ nonce novo a cada gravação
                           ▼
   ┌─────────────────────────────────────────────────────────┐
   │  Campos de texto                                        │
   │  nome · e-mail · descrições · observações · notas       │
   └─────────────────────────────────────────────────────────┘
```

**Por que DEK por usuário.** Vazar o registro de uma pessoa não ajuda a ler o de
outra. E trocar a KEK re-embrulha apenas as DEKs — uma linha por usuário — sem
reescrever um único texto criptografado.

**Por que AAD.** Os dados autenticados adicionais amarram cada cifra ao seu
contexto. Sem isso, quem tivesse acesso ao banco poderia **mover** um valor
criptografado de um registro para outro e ele continuaria abrindo. Com AAD, o
deslocamento invalida a tag e a leitura falha.

### Formatos

| Uso | Formato |
|---|---|
| Campo | `enc:v1:<nonce_b64>:<ciphertext_b64>:<authTag_b64>` |
| DEK embrulhada | `dek:v1:<kekVersion>:<nonce>:<ciphertext>:<tag>` |
| Lookup de e-mail | `hml:v1:<hmac_sha256_hex>` |

Validação estrita: envelope malformado é rejeitado. Um valor que **começa com
`enc:`** mas está corrompido **falha alto** em vez de devolver lixo — só texto
sem o prefixo é tratado como dado legado.

---

## 2. E-mail criptografado e pesquisável

O e-mail precisa continuar servindo para login, unicidade e busca. A solução são
duas colunas:

- `email_encrypted` — o envelope, ilegível sem a DEK.
- `email_lookup` — **HMAC-SHA-256** do e-mail normalizado, com chave própria
  (`EMAIL_LOOKUP_KEY_V1`), separada da KEK.

**Por que HMAC e não SHA-256 puro.** Com hash simples, qualquer um que copie a
coluna monta um dicionário dos e-mails mais comuns e descobre quem está na base.
Com HMAC, sem a chave isso é inviável.

**Normalização.** Uma única função (`normalizeEmail`) usada em cadastro, login,
recuperação e busca — apara espaços e minusculiza, nada mais. Remover pontos ou
sufixos `+` trataria endereços legítimos e distintos como iguais.

---

## 3. Campos: o que criptografar e o que preservar

### Criptografar (texto livre e identificação)

| Tabela | Campo |
|---|---|
| `users` | `name`, `email` |
| `incomes` / `income_templates` | `description`, `observation` |
| `expenses` / `fixed_expense_templates` | `description`, `observation` |
| `debts` | `description`, `observation` |
| `goals` | `name`, `description` |
| `savings_buckets` | `name` |
| `savings_transactions` | `observation` |
| `cards` | `name` |
| `categories` | `name` (apenas as personalizadas) |

### **Não** criptografar (o sistema calcula em cima)

Valores `Decimal` (`value`, `paid_amount`, `remaining_balance`, limites),
datas, status, enums, IDs e chaves estrangeiras.

**Motivo:** `SUM`, filtros, fechamento de mês, projeções, alertas e validação de
saldo dependem de comparar e somar no banco. Criptografar esses campos quebraria
o produto inteiro e obrigaria a carregar tudo para a memória a cada consulta.

### Consequência aceita

Busca textual do tipo `contains` **deixa de funcionar** em campo criptografado —
o banco não consegue procurar dentro da cifra. Onde a busca por descrição for
necessária, ela passa a ser feita em memória, sobre registros já autorizados e
decifrados, com limite de volume.

---

## 4. Migração em fases (obrigatória)

O sistema está **em produção com dados reais**. Uma migração de criptografia mal
conduzida é irreversível. Por isso o roteiro é este, sem atalho:

**Fase 1 — código tolerante (esta entrega)**
Serviço de criptografia publicado. Sem chaves configuradas, ele opera em modo
compatível e **nada muda**. O código lê tanto texto puro quanto envelope.

**Fase 2 — colunas novas**
Migration aditiva: adiciona `*_encrypted`, `email_lookup`, `encrypted_data_key`.
As colunas antigas **permanecem**. Nenhuma leitura muda.

**Fase 3 — backfill**
Script em lotes, idempotente, com `--dry-run` e retomada por ID. Gera a DEK de
cada usuário, criptografa os textos, cria o lookup. Não imprime nome, e-mail nem
descrição — só contagens e IDs.

**Fase 4 — corte de escrita**
Escritas passam a gravar só criptografado. `ENCRYPTION_REQUIRED=true`.

**Fase 5 — limpeza**
Só depois de confirmar que **zero** registros ficaram para trás: tornar as
colunas novas obrigatórias e remover as antigas.

### Rollback

| Fase | Como voltar |
|---|---|
| 1 | Remover as variáveis de ambiente. O código volta ao modo compatível. |
| 2 | Colunas novas são aditivas e ficam nulas. Sem impacto. |
| 3 | O backfill não apaga nada. Basta parar; os dados antigos continuam nas colunas originais. |
| 4 | Voltar `ENCRYPTION_REQUIRED=false` e o deploy anterior. |
| 5 | **Sem volta.** Só executar após backup validado e restaurado num ambiente de teste. |

---

## 5. Rotação de chaves

**KEK.** Adicionar `DATA_KEK_V2`, apontar `DATA_KEK_CURRENT_VERSION=2` e
**manter a V1**. Novos embrulhos usam a V2; os antigos continuam abrindo pela V1.
Um job re-embrulha as DEKs (`rotateUserDataKey`) — **nenhum texto é reescrito**.
Só depois que todas as DEKs estiverem na V2 a V1 pode sair do ambiente.

**Chave de lookup.** Mesmo princípio, com um detalhe: durante a transição a
busca precisa testar os candidatos de todas as versões
(`createEmailLookupCandidates`), senão o login quebra para quem ainda está na
versão antiga.

**Perda da KEK = perda definitiva dos dados.** Não existe recuperação. A cópia
de emergência offline não é opcional.

---

## 6. Contas do PostgreSQL

SQL pronto em [`database-roles.sql`](./database-roles.sql), com os testes de
permissão no rodapé.

| Conta | Uso | Pode |
|---|---|---|
| `financashub_app` | backend em runtime | só DML; sem DDL, sem criar papéis, sem `BYPASSRLS` |
| `financashub_migration` | deploy de migrations | DDL; fora do processo HTTP |
| `financashub_breakglass` | emergência | leitura; lacrada, uso registrado, rotação após incidente |

Hoje as três funções usam a **mesma** credencial. Separar limita o estrago de
uma falha na aplicação: sem DDL, uma injeção de SQL não consegue derrubar
tabelas.

---

## 7. Row-Level Security — **documentado, não implementado**

A especificação determina implementar RLS apenas com validação em PostgreSQL
real, e **não implementar pela metade**. Neste ambiente não há PostgreSQL nem
como instalá-lo, então RLS fica **fora desta entrega, por decisão explícita**.

Esboço para a fase futura:

```sql
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses FORCE ROW LEVEL SECURITY;

CREATE POLICY expenses_owner ON expenses
  USING (user_id = current_setting('app.current_user_id')::bigint)
  WITH CHECK (user_id = current_setting('app.current_user_id')::bigint);
```

Pré-requisitos antes de habilitar:

1. Runtime **não** pode ser dono das tabelas nem ter `BYPASSRLS` (item 6).
2. `SET LOCAL app.current_user_id` **dentro** da transação — nunca no nível da
   sessão, senão o contexto vaza entre usuários no pool de conexões.
3. Testes tentando ler dados de outro usuário devem falhar.
4. Política para **todas** as tabelas financeiras — cobrir metade dá falsa
   sensação de segurança.

---

## 8. O que esta fase **não** entrega

Para não haver dúvida sobre o estado real:

- [ ] Migration das colunas criptografadas (Fase 2)
- [ ] Script de backfill (Fase 3)
- [ ] Aplicação da criptografia nos serviços de domínio
- [ ] `AdminAccount`, `AdminSession`, MFA TOTP, `AdminAuditLog` encadeado
- [ ] RBAC administrativo (OWNER / ADMIN / SUPPORT / AUDITOR)
- [ ] `AccessGrant` (concessão manual de Pro)
- [ ] Endpoints `/api/admin/*`
- [ ] `PrivacyRequest`, `ConsentRecord`, exclusão e exportação
- [ ] Métricas, diagnóstico, anúncios, feature flags
- [ ] RLS

---

## 9. Validação executada

| Comando | Resultado |
|---|---|
| `node --check` nos arquivos novos | passou |
| `npx jest tests/security/` | **41 testes, 0 falhas** |
| `npx jest` (suíte completa) | ver relatório da entrega |
| `npx prisma validate` | **não executável** neste ambiente |
| `npx prisma format` | **não executável** |
| `npx prisma migrate status` / `diff` | **não executável** |
| Testes de integração com PostgreSQL | **não executáveis** |

**Motivo das falhas de execução:** o download dos engines do Prisma retorna
`403 Forbidden` (`binaries.prisma.sh`) e não há PostgreSQL instalado nem
permissão para instalar. Isso está registrado aqui em vez de ser omitido: os
comandos da seção 24 precisam ser rodados por você, num ambiente com acesso.

---

## 10. Riscos conhecidos

1. **Perda da KEK é irreversível.** Cópia offline antes de qualquer coisa.
2. **O backfill toca todos os registros.** Rodar em cópia do banco primeiro,
   com `--dry-run`, e só então em produção — fora do horário de pico.
3. **`prisma migrate diff` não foi validado aqui.** Rode antes de aplicar.
4. **Busca textual será perdida** nos campos criptografados. Decisão de produto
   a confirmar antes da Fase 4.
5. **O dono continua vendo os valores.** Criptografar nomes e descrições impede
   identificar *quem* é e *o que* comprou, mas os montantes seguem legíveis —
   é o que mantém o produto funcionando.
