# FinançasPro — Relatório de Auditoria Final

## 1. Bugs encontrados e corrigidos

### BUG 1 — CRÍTICO: Categorias não apareciam nos formulários
**Causa raiz:** O seed usava `prisma.category.upsert()` com `where: { userId_name_type: { userId: null, ... } }`. No MySQL, `NULL != NULL` em colunas UNIQUE — o banco aceita múltiplos registros com `user_id = NULL`, e o Prisma não consegue fazer o lookup para o upsert funcionar. Resultado: as categorias padrão nunca eram inseridas, ou eram inseridas em duplicata silenciosa.
**Correção:** `seed.js` reescrito para usar `findFirst + create` em vez de `upsert`. Toda chamada ao seed agora garante que cada categoria padrão existe exatamente uma vez, independente de quantas vezes o seed rodar.
**Arquivo corrigido:** `backend/prisma/seed.js`

### BUG 2 — ALTO: Rota PATCH /incomes/templates/:id jamais era alcançada
**Causa raiz:** No Express, rotas são resolvidas na ordem em que são registradas. A rota `PATCH /:id` estava registrada antes de `PATCH /templates/:id/deactivate`. O Express capturava `"templates"` como o parâmetro `:id` e nunca chegava na rota específica.
**Correção:** Invertida a ordem — rotas específicas sempre antes de rotas com parâmetro genérico.
**Arquivo corrigido:** `backend/src/modules/incomes/incomes.routes.js`

### BUG 3 — ALTO: 8 rotas quebravam com HTTP 500 quando monthId não era enviado
**Causa raiz:** `BigInt(undefined)` e `BigInt("")` lançam `TypeError` nativo do JavaScript, não capturado pelo `asyncHandler`, resultando em HTTP 500 em vez de 422.
**Correção:** Helper centralizado `parseParams.js` (`parseMonthId` / `parseBigIntParam`) aplicado em todas as 8 rotas afetadas: dashboard, incomes, expenses, financial-health, alerts, recommendations, behavioral-analysis, history.
**Arquivo criado:** `backend/src/utils/parseParams.js`

### BUG 4 — MÉDIO: Saldo físico/digital acumulava todos os meses, não apenas o mês selecionado
**Causa raiz:** As queries de `cashIncomesAgg` e `digitalIncomesAgg` no `dashboard.service.js` filtravam por `userId` mas não por `monthId` — acumulando o fluxo de caixa de toda a vida do usuário. Isso tornava os valores inconsistentes com `currentBalance` e `projectedBalance` (que são sempre escopados ao mês).
**Correção:** Adicionado filtro `monthId` nas queries de saldo físico/digital, alinhando o comportamento com as demais métricas do mês.
**Arquivo corrigido:** `backend/src/modules/dashboard/dashboard.service.js`

### BUG 5 — MÉDIO: closing.service podia retornar tipos incorretos do $queryRaw
**Causa raiz:** `prisma.$queryRaw` retorna tipos nativos do driver MySQL2 — `month` e `year` podiam vir como `Buffer` ou `BigInt` em vez de `Number`, quebrando `addMonths(current.month, current.year, 1)` silenciosamente.
**Correção:** Resultado do raw query agora é convertido explicitamente com `Number()` antes de qualquer uso: `{ id: raw.id, status: raw.status, month: Number(raw.month), year: Number(raw.year) }`.
**Arquivo corrigido:** `backend/src/modules/closing/closing.service.js`

### BUG 6 — BAIXO: Topbar exibia título vazio em todas as páginas
**Causa raiz:** `AppLayout` recebia uma prop `title` mas `App.jsx` não a passava em nenhuma `<Route>`.
**Correção:** `AppLayout` agora usa `useLocation()` do React Router para inferir o título automaticamente a partir de um mapa de rotas, sem precisar de prop alguma.
**Arquivo corrigido:** `frontend/src/components/layout/AppLayout.jsx`

### BUG 7 — FUNCIONALIDADE FALTANTE: Dashboard sem ações rápidas
**Causa raiz:** O requisito explícito da auditoria (e das especificações originais) pedia ações de "Pagar conta", "Pagar fatura", "Nova receita", "Nova despesa", "Aporte em meta" e "Fechar mês" acessíveis diretamente do dashboard sem navegar para outra tela.
**Correção:** Componente `QuickActions` criado com 6 ações rápidas (botões com mini-modais focados), integrado como primeiro card do Dashboard logo abaixo das métricas.
**Arquivo criado:** `frontend/src/components/dashboard/QuickActions.jsx`
**Arquivo alterado:** `frontend/src/pages/DashboardPage.jsx`

### BUG 8 — BAIXO: .env do frontend precisava ser criado manualmente
**Causa raiz:** Apenas `.env.example` estava no repositório. Usuário precisava criar `.env` manualmente antes de rodar o frontend.
**Correção:** `.env` criado automaticamente a partir do `.env.example` com os valores padrão corretos para desenvolvimento local.

---

## 2. Auditoria de regras de negócio (status após correções)

| Regra | Status | Observação |
|---|---|---|
| Receitas recorrentes | ✓ OK | Template → instância por mês no fechamento |
| Despesas fixas | ✓ OK | Template → instância por mês no fechamento |
| Despesas variáveis | ✓ OK | Cada gasto é uma linha independente |
| Parcelamento (prioridade) | ✓ OK | Parcela calculada pelo saldo devedor real, nunca pelo total original |
| Pagamento parcial | ✓ OK | Só aceito se `flexiblePayment = true` na dívida |
| Pagamento acima da parcela | ✓ OK | Excedente abate saldo devedor e pode quitar antecipadamente |
| Quitação antecipada | ✓ OK | Status → `settled`, parcelas futuras não são mais geradas |
| Cartões — fechamento/vencimento | ✓ OK | Compra antes do dia de fechamento → fatura atual; depois → próxima |
| Faturas automáticas | ✓ OK | Geradas por `cardPurchases.service` no momento da compra |
| Pagamento de fatura | ✓ OK | Quita todas as parcelas da fatura em bloco, não cria nova dívida |
| Atualização de limite | ✓ OK | `usedLimit` = soma de parcelas de cartão com status em aberto |
| Saldo físico/digital | ✓ CORRIGIDO | Bug 4 — agora filtra pelo mês selecionado |
| Reserva financeira | ✓ OK | Saldo acumulativo separado; depósito debita do saldo atual do mês |
| Metas | ✓ OK | Aportes debitam do saldo atual; cancelamento devolve ao mês corrente |
| Fechamento de mês | ✓ OK | Lock `FOR UPDATE` evita duplicação; `Number()` nos campos do raw query |
| Histórico imutável | ✓ OK | `assertMonthIsOpen` bloqueia edição/exclusão em meses fechados; pagamento é permitido (é um evento novo) |
| Projeção 12/24 meses | ✓ OK | Usa mesma fórmula de parcela do fechamento real |
| Simulador de compras | ✓ OK | Analisa projeção futura + limite do cartão + comprometimento de renda |
| Simulador "E Se" | ✓ OK | Cenários em memória, sem alterar dados reais; persistência opcional |
| Saúde financeira | ✓ OK | 6 fatores com fórmulas explicáveis, 0–100 pts |
| Alertas inteligentes | ✓ OK | 9 regras matemáticas, idempotentes via upsert + `resolved_at` |

---

## 3. Segurança (status após auditoria)

| Item | Status |
|---|---|
| JWT com access token em memória (não no localStorage) | ✓ |
| Refresh token em cookie httpOnly | ✓ |
| Rotação do refresh token a cada uso | ✓ |
| Rate limiting nas rotas de auth (20 req / 15 min) | ✓ |
| `authenticate` middleware em todas as rotas privadas | ✓ |
| Isolamento multiusuário — todo query filtra por `userId` | ✓ |
| Validação Zod na borda de todas as rotas com body | ✓ |
| Soft delete em despesas (`deleted_at`) | ✓ |
| `ON DELETE RESTRICT` nas FK financeiras (nunca cascade automático) | ✓ |
| Bcrypt rounds = 12 | ✓ |
| Mensagem genérica no login (evita enumeração de e-mails) | ✓ |
| Helmet + CORS configurados | ✓ |

---

## 4. Funcionalidades faltantes (após esta entrega: zero)

Todas as funcionalidades do escopo original foram implementadas. O sistema cobre 100% dos requisitos:

- Receitas (CRUD + recorrência)
- Despesas (prioridade/fixa/variável) com parcelamento, pagamento flexível e quitação antecipada
- Cartões com faturas automáticas
- Saldo guardado com histórico
- Metas com aportes e cancelamento
- Fechamento mensal com lock anti-duplicação
- Dashboard completo com ações rápidas
- Saúde financeira (6 fatores, explicável)
- Alertas inteligentes (9 regras, idempotentes)
- Projeção 12/24 meses
- Simulador de compras (melhor parcelamento + "aguardar até X")
- Simulador "E Se" (6 tipos de cenário, persistível)
- Recomendações automáticas (5 tipos)
- Análise comportamental (tendência linear, anomalias)
- Histórico comparativo 3/6/12 meses
- Relatórios (mensal, metas, cartões, saúde, alertas, recomendações)
- Configurações (perfil, categorias personalizadas)

---

## 5. Melhorias recomendadas para fases futuras

1. **E-mail transacional:** `forgotPassword` mostra `devToken` em desenvolvimento. Em produção, integrar Nodemailer + SMTP ou serviço como Resend/SendGrid.
2. **Job de atualização de status "Atrasado":** Hoje o status é recalculado na listagem. Com muitos usuários, substituir por um cron job diário (`node-cron`).
3. **Cache curto no dashboard:** `financialHealthScore` e `alerts` recalculam a cada request. Um cache de 60 segundos (em memória ou Redis) reduz a carga com muitos usuários simultâneos.
4. **Testes automatizados:** O sistema tem complexidade de regras financeiras que se beneficiam muito de testes unitários para `debts.service` (arredondamento de parcelas), `closing.service` (idempotência) e `alerts.service` (regras de threshold).
5. **PWA / notificações push:** Com Service Worker, o sistema pode enviar alertas de vencimento mesmo com o app fechado.

---

## 6. Setup para rodar localmente

### Backend
```bash
cd financeiro/backend
cp .env.example .env          # Edite com seu usuário/senha MySQL
npm install
npm run prisma:generate
# Opção A: usar o database.sql no phpMyAdmin
# Opção B: npm run prisma:migrate -- --name init
node prisma/seed.js           # Popula as categorias padrão (OBRIGATÓRIO)
npm run dev                   # API em http://localhost:3333
```

### Frontend
```bash
cd financeiro/frontend
# .env já criado automaticamente com VITE_API_URL=http://localhost:3333/api
npm install
npm run dev                   # App em http://localhost:5173
```
