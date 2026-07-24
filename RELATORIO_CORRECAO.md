# FinançasHub — Relatório de Correção

Etapa de implementação, autorizada após a auditoria. Base: o ZIP enviado nesta
conversa, extraído limpo em pasta vazia. Pasta principal renomeada de
`financeiro2-master` para `financeiro`, conforme solicitado.

Stripe **não foi tocado**. F-14 e F-15 seguem abertos por decisão do proprietário
(ver seção "Não corrigido").

---

## 1. Correção de premissa da auditoria

O prompt pedia para **não recriar** arquivos de Assinaturas "que aparentemente não
existem". Verifiquei no ZIP limpo, antes de qualquer alteração, e **eles existiam**:

```
EXISTE: backend/src/modules/subscriptions/{routes,service,validators}.js
EXISTE: backend/tests/services/subscriptions.service.test.js
EXISTE: frontend/src/pages/SubscriptionsPage.jsx
EXISTE: frontend/src/components/CloseMonthDialog.jsx
EXISTE: frontend/src/components/LocaleSwitcher.jsx
```

Confirmei por busca de imports que os cinco são **código morto real** (só se
autorreferenciam; a tabela `subscriptions` foi removida pela migration
`20260721030000`, e `CloseMonthDialog`/`LocaleSwitcher` têm cópias vivas em
`QuickActions.jsx` e `SettingsPage.jsx`). Removi todos. Não recriei nada.

---

## 2. Ambiente e validação executada

| Comando | Resultado | Observação |
|---|---|---|
| `npm install` (backend/frontend) | EXIT=0 | — |
| `npx jest --ci` (backend) | **253 passam, 0 falham** (33 suítes) | era 231/12 |
| `npm run build` (frontend) | ✓ built, 770 módulos | — |
| `npm run check:security` | OK | — |
| `npm run check:v16-flows` | OK | — |
| `npm run check:v18-critical` | OK | — |
| `npm run check:v19-history` | OK | asserção atualizada p/ nova arquitetura |
| `npm run check:i18n-userdata` (novo) | OK | teste real, 4 idiomas |
| `npm audit` (backend) | **0 vulnerabilidades** | era 1 low |
| `npm audit` (frontend) | 2 moderate (react-router) | high do vite **eliminado** (bump 5→7) |
| `npx prisma validate / migrate diff` | **NÃO EXECUTADO** | `binaries.prisma.sh` → 403 no sandbox. Ver "Validação humana" |

**Nenhum comando é reportado como executado sem ter sido.** O único bloqueio real
é o download dos engines do Prisma, isolado pela rede do sandbox.

---

## 3. Correções por achado

### Corrupção financeira

**F-02 — dívida encerrada com saldo devedor** (`debts.service.js`)
`generateNextInstallment` só marca `settled` quando `remainingBalance <= 0.009`
(tolerância única `SETTLE_TOLERANCE`). Se o plano original acaba com saldo em
aberto (típico de pagamento flexível), gera **parcela residual** e estende
`installmentsCount` — nunca apaga o saldo nem remove a dívida do total ativo.
`applyPaymentToInstallment` passou a **recusar** pagamento acima do saldo devedor
(antes o excedente sumia). Testes: `financialFixes.test.js` (3 casos de residual +
tolerância + pagamento acima).

**F-29 — indicador "0 parcelas" com dívida ativa** (`debts.service.js`, `DashboardPage.jsx`)
Novo `getDebtIndicators()` devolve dados reais: nº de dívidas ativas, saldo devedor
total, **parcelas restantes derivadas do saldo** (`remainingInstallmentsFor`) e a
próxima parcela real (1 query, sem N+1 por dívida). O Dashboard consome esses
valores; a contagem antiga (lista truncada de vencimentos, `LIMIT 5`) foi removida.

**F-04 — despesa fixa no cartão contada 2×** (`projections.service.js`)
`getActiveRecurringTotals` exclui `paymentMethod: 'credit'` do total de fixas —
essas já entram pelo `cardSchedule`. A despesa continua na aba Despesas Fixas, na
fatura e no limite; só deixou de ser somada em dobro em projeções, relatórios e
simulador. Teste cobre o `where: { paymentMethod: { not: 'credit' } }`.

**F-03 — `payInvoice` reescrevia `paidAt` de parcelas já pagas** (`cardInvoices.service.js`)
Reescrito: `SELECT ... FOR UPDATE` na fatura (serializa duplo clique/duas abas),
seleciona os ids **pendentes** antes, e o SQL cru (`paid_amount = value`) fica
restrito a `id = ANY($ids)`. Parcela já paga em outro mês nunca tem a data
contábil movida. Idempotente (segunda chamada encontra `status='paid'` → 409).
Pagamento **parcial documentado como pendência** — ver seção 6.

### Histórico imutável (o furo da V19)

**F-06 / F-22 — imutabilidade só existia no Dashboard + N+1 no Histórico**
Criado `months/monthFacts.service.js` como **fonte única de verdade**:
mês fechado com snapshot válido → retorna o snapshot congelado (0 queries);
mês aberto → calcula ao vivo. `history.service.js` reescrito para usar
`getMonthFactsBatch` — os mesmos números do Dashboard, e a janela de 6 meses caiu
de ~100 queries para ~3. `normalizeFacts` blinda o Dashboard contra snapshot
antigo/incompleto/corrompido (zera campos ausentes em vez de `NaN`).

**F-07 / F-08 — bump de versão sobrescreveria snapshots corretos** (`monthSnapshot.service.js`)
`ensureClosedMonthSnapshot` **nunca** sobrescreve snapshot existente — só cria o
que falta (base pré-V19). Nova tabela `month_snapshot_versions` **arquiva** cada
versão com motivo e data. `rebuildClosedMonthSnapshot()` é o caminho de migração
**controlada** (arquiva antes, registra o motivo). `validSnapshot` agora aceita
qualquer versão conhecida (≥1, ≤atual): um mês de 2026 continua sendo o retrato
correto de 2026, mesmo depois de o formato evoluir.

### Receitas (regras definitivas preservadas)

- **F-05 e F-01 NÃO foram tratados como bug** — receita futura entra no saldo na
  hora; saque de reserva externa volta ao saldo. Preservados conforme decisão de
  produto (seções 6 e 7 do prompt).
- **§9.5 recorrência idempotente:** índice único `(template_id, month_id)` +
  `skipDuplicates` no fechamento. Backfill desvincula duplicatas antigas mantendo
  o lançamento mais antigo (nada de dinheiro é apagado).
- **§9.6 edição com escopo:** `updateIncome` aceita `scope: 'single' | 'future'`.
  `future` atualiza o template e as ocorrências de meses **abertos**; meses
  fechados ficam intactos. Novo `POST /incomes/:id/end-recurrence`.
- **§9.7 correção segura:** `deleteIncome` deixou de bloquear por saldo. Se a
  exclusão deixaria o saldo negativo, retorna 409 com o impacto calculado e exige
  `?confirm=true`; a operação é registrada no `audit_log`. Erro de digitação deixou
  de ser permanente.

### Métodos de pagamento (§12)

`utils/paymentMethods.js`: `normalizePaymentMethod` mapeia pix/transfer/debit →
`debit` (saldo da conta), preservando `cash` e `credit`. Dados antigos continuam
legíveis; novos registros usam o canônico. No frontend, `setPayMethod('pix')`
inicial virou `ACCOUNT_BALANCE_METHOD`, e todo `<option>` de dado do usuário abre
com uma opção válida selecionada.

### Relatórios para Básico (§13) — F-12

`reports.routes.js` responde **200 para todos**, com payload dividido por plano
(`tier: 'basic' | 'pro'`; blocos avançados só quando `isPro`). `ReportsPage.jsx`
nunca mais retorna `null`: estado de erro visível com "Tentar novamente" + upsell
para o Básico. Gating continua no **backend**.

### Alertas e sessão

- **§14 / F-13:** painel de notificações vai ao **Dashboard** (recurso básico); a
  análise avançada só aparece para Pro. Throttle em `alerts.service.js`:
  `getAlerts` recomputa no máximo 1×/janela por usuário/mês; o polling da Topbar
  passou a **leitura pura** (deixou de gravar a cada minuto por aba).
- **§15 refresh:** família de refresh tokens (`family_id`) com **detecção de
  reuso** — apresentar um token já rotacionado fora da janela de graça **revoga a
  família inteira** (token roubado deixa de ser utilizável em silêncio). `logout`
  revoga a família do dispositivo; novo `POST /auth/logout-all`. A janela de graça
  de 10s (correção legítima entre abas) foi preservada.
- **§15 CORS:** `createOriginPolicy({ allowPreviews })`. Em produção,
  `allowPreviews=false` por padrão — previews da Vercel **deixam de ter acesso
  credenciado** à API/banco reais. Staging pode religar com `CORS_ALLOW_PREVIEWS=true`.

### Internacionalização (§16) — F-24

`i18n/UserText.jsx` marca regiões de dado do usuário com `data-i18n-ignore`. O
`I18nBridge` ganhou `IGNORED_REGION_SELECTOR` com `FILTER_REJECT`: dados do usuário
**e SVG (gráficos)** são podados do `MutationObserver` — resolve o "Salário → Salary"
e reduz o escopo do observer (F-25). Aplicado a 15 arquivos. Categoria **padrão**
continua traduzível; categoria criada pelo usuário, não. Novo teste real
`check:i18n-userdata` valida os 4 idiomas e a proteção estrutural. Migração para
i18n por chaves: iniciada a separação (UserText + poda), **não concluída** — ver
"Não corrigido".

### Fuso (§17) — F-28

Saudação da Topbar usa `Intl.DateTimeFormat` com o `timeZone` configurado, não
`new Date().getHours()`.

### Dashboard e patrimônio (§18) — F-30

Novos cards **"Em metas"** e **"Patrimônio financeiro"** (saldo + físico + reservas
+ metas). Aporte em meta deixou de "sumir" do painel. `getWealthBreakdown` no
backend, com nota de que mover dinheiro entre componentes não é ganho nem perda.

### Mês fechado (§11) — F-31 / F-32

`QuickActions` recebe `isClosedMonth` e desabilita Receita/Despesa/Pagar/Fatura/Meta
com aviso explicativo **antes** do formulário (o backend continua validando com 409).
Só "Reparar mês" permanece disponível.

### Desempenho (§19)

- Dashboard: `refreshAlerts` (gravava a cada carga) → `getAlerts` (throttled).
- Histórico: N+1 eliminado (snapshot em lote).
- Frontend: **code splitting por rota**. `index` caiu de **574 kB → 338 kB**;
  Recharts (422 kB) e cada página viraram chunks sob demanda — Login/Configurações
  não baixam mais os gráficos. `Suspense` com fallback.
- Índices com evidência (ver migration): `expenses(user_id, paid_at)`,
  `incomes(user_id, income_date)`, `savings_transactions(user_id, transaction_date)`,
  `goal_contributions(month_id)`, `expenses(debt_id, status)`.

### Código morto (§21)

Removidos os 5 arquivos da seção 1. Nenhuma referência órfã restante (verificado).

---

## 4. Migrations criadas e estratégia de backfill

Todas **aditivas**, compatíveis com dados existentes, sem `DELETE` de dado do
usuário e sem `migrate reset`.

**`20260724120000_financial_integrity`**
- Unicidade `incomes_template_id_month_id_key`. Backfill: `ROW_NUMBER()` por
  `(template_id, month_id)` desvincula duplicatas mantendo a mais antiga (o
  lançamento continua existindo, só deixa de ser a ocorrência da recorrência).
- Tabela `month_snapshot_versions` + backfill que arquiva todo snapshot atual como
  `version 1` (`reason='initial_backfill'`) — nenhum retrato original se perde.
- 5 índices de performance (lista acima).

**`20260724130000_refresh_token_family`**
- `refresh_tokens.family_id` (backfill: cada token vira raiz da própria família —
  sessões ativas continuam válidas), índices `family_id` e `(user_id, revoked_at)`.

**Drift:** adicionei `map:` nos índices/uniques do `schema.prisma` para casar os
nomes reais das migrations (`expenses_fixed_template_competence_key` etc.). O
`prisma migrate diff` **não pôde ser executado** (engine 403), então o drift
residual continua **não confirmado** — deve ser verificado em ambiente com rede.

---

## 5. Testes adicionados

- `tests/services/financialFixes.test.js` (21 testes): dívida residual e quitação
  por saldo, pagamento acima do saldo, indicadores reais, dupla contagem de fixa no
  cartão, métodos canônicos, `getMonthFacts` (snapshot vs. vivo), `normalizeFacts`
  (JSON corrompido).
- `tests/services/cardInvoices.service.test.js` reescrito p/ o novo lock +
  cobertura de F-03 (parcela paga não reescrita, EMPTY_INVOICE, cartão próprio).
- 2 testes de audit log atualizados p/ o formato sanitizado da V15.
- `frontend/scripts/check-i18n-userdata.mjs`: teste executável de i18n.

**Cobertura ainda ausente (recomendada):** integração com Postgres real (a suíte é
100% mock — nenhum dos bugs financeiros seria pego por mock puro), webhook Stripe
duplicado, limite de 2 cartões sob concorrência real.

---

## 6. Não corrigido (por decisão ou por bloqueio)

| Item | Motivo |
|---|---|
| **F-14, F-15 (Stripe)** | Proibido pelo proprietário nesta etapa. Pro fora do webhook e loop de retry seguem abertos. |
| **Pagamento parcial de fatura (§22)** | Preservei o integral funcionando. Parcial exigiria decisão de produto (como alocar valor entre parcelas, quanto de limite liberar) — não improvisei. Documentado como pendência. |
| **i18n por chaves (§16, 2ª metade)** | Iniciada a separação estrutural (UserText + poda do observer). Migração completa para `t('chave')` é grande e fica como próximo passo. |
| **Validação responsiva em navegador (§24)** | Sem navegador no sandbox. Análise estática apenas (100dvh, safe-area, painel contido — todos OK no CSS). |
| **`prisma validate` / `migrate diff`** | `binaries.prisma.sh` → 403. Drift (F-16) não confirmável aqui. |
| **react-router 2 moderate** | Open-redirect via `<Link>`; o app não passa URL do usuário para `Link`/`navigate` (verificado). Upgrade v6→v7 é major e arriscado — mantido, documentado como risco residual. |

---

## 7. Passos de deploy

**Ordem: backend primeiro, frontend depois.**

1. **Backup do banco** (obrigatório — há migrations com backfill).
2. Backend (Render):
   - `npm install`
   - `npx prisma migrate deploy` (aplica as 2 migrations aditivas)
   - reiniciar o serviço
   - Confirmar variáveis: em produção **não** definir `CORS_ALLOW_PREVIEWS`
     (previews ficam bloqueados).
3. Frontend (Vercel): `npm install && npm run build && deploy`.
4. Como o backend é retrocompatível (colunas aditivas, `family_id` com backfill),
   um curto período com frontend antigo + backend novo é seguro.

## 8. Rollback

- **Código:** redeploy do commit/ZIP anterior (você tem backup).
- **Banco:** as migrations são aditivas; reverter o código **não** exige derrubar
  as colunas novas (elas são ignoradas pela versão antiga). Se necessário reverter
  o schema, `family_id` e `month_snapshot_versions` podem ser dropadas sem perda de
  dado financeiro. **Não** rode `migrate reset`.

## 9. Checklist pós-deploy

- [ ] Login, refresh entre 2 abas, logout, logout-all.
- [ ] Fechar um mês → mês seguinte recebe recorrências e parcelas (sem duplicar ao repetir).
- [ ] Reparar mês (idempotente).
- [ ] Dívida com pagamento flexível não some com saldo devedor > 0.
- [ ] Dashboard: card de dívida nunca mostra "0 parcelas" com saldo ativo.
- [ ] `/reports` abre para conta Básica (sem tela branca).
- [ ] Receita "Salário" **não** vira "Salary" ao trocar idioma.
- [ ] Pagar fatura não altera meses anteriores; segunda tentativa dá 409.
- [ ] Mês fechado: ações rápidas desabilitadas com aviso.
- [ ] Previews da Vercel **não** acessam a API de produção.

---

## 10. Riscos residuais

1. **Drift do Prisma não confirmado** (engine 403) — validar em ambiente com rede
   antes do primeiro `migrate dev` futuro.
2. **Suíte sem integração de banco** — os bugs financeiros corrigidos precisam de
   testes contra Postgres real para não regredirem.
3. **Stripe** (F-14/F-15) intocado.
4. **react-router** 2 moderate (open-redirect não explorável neste app).
5. **Pagamento parcial de fatura** ausente.
