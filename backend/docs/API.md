# API — Documentação (módulos implementados)

Base URL local: `http://localhost:3333/api`

Autenticação: rotas privadas exigem header `Authorization: Bearer <accessToken>`.
O `refreshToken` viaja em cookie httpOnly (`refresh_token`), nunca no body/JSON — por isso o front precisa enviar requisições com `credentials: 'include'`.

---

## Auth

### POST /auth/register
Body: `{ name, email, password }`
201 → `{ user, accessToken }` + cookie `refresh_token`
Erros: `409 EMAIL_IN_USE`, `422 VALIDATION_ERROR`

### POST /auth/login
Body: `{ email, password }`
200 → `{ user, accessToken }` + cookie `refresh_token`
Erros: `401 INVALID_CREDENTIALS`

### POST /auth/refresh
Sem body (usa cookie `refresh_token`).
200 → `{ accessToken }` + novo cookie `refresh_token` (rotacionado)
Erros: `401 UNAUTHORIZED`

### POST /auth/logout
Sem body. Revoga o refresh token atual e limpa o cookie.
204

### POST /auth/forgot-password
Body: `{ email }`
200 → `{ message }` (sempre sucesso, mesmo se o e-mail não existir — evita enumeração)
Em desenvolvimento (`NODE_ENV != production`), a resposta também inclui `devToken` para testar o fluxo sem servidor de e-mail configurado.

### POST /auth/reset-password
Body: `{ token, password }`
200 → `{ message }`
Erros: `400 INVALID_RESET_TOKEN`

---

## Months

Todas as rotas exigem autenticação.

### GET /months
200 → `{ months: Month[] }` (todos os meses do usuário, mais recente primeiro)

### GET /months/current
Retorna (criando se necessário) o mês correspondente à data atual do servidor.
200 → `{ month }`

### GET /months/:id
200 → `{ month }` | `404 MONTH_NOT_FOUND`

---

## Categories

### GET /categories?type=income|expense
200 → `{ categories }` (padrão do sistema + personalizadas do usuário)

### POST /categories
Body: `{ name, type }`
201 → `{ category }`
Erros: `409 CATEGORY_ALREADY_EXISTS`

### DELETE /categories/:id
204 | `404 CATEGORY_NOT_FOUND` | `409 CATEGORY_IN_USE` (categoria já usada em lançamentos)

---

## Incomes (Receitas)

### GET /incomes?monthId=123
200 → `{ incomes }`

### POST /incomes
Body: `{ monthId, description, value, categoryId, paymentMethod, origin, date, observation?, recurring }`
- `paymentMethod`: `cash | pix | debit | credit | transfer`
- `origin`: `digital | physical`
- Se `recurring: true`, cria também um `income_template` que será usado no Fechamento Mensal (Etapa 15) para gerar a receita automaticamente nos próximos meses.

201 → `{ income }`
Erros: `404 MONTH_NOT_FOUND`, `409 MONTH_CLOSED`, `422 DATE_OUTSIDE_MONTH`, `422 INVALID_CATEGORY`

### PATCH /incomes/:id
Body parcial (qualquer subconjunto de `description, value, categoryId, paymentMethod, origin, date, observation`).
Edita apenas a instância do mês — nunca o template de recorrência.
200 → `{ income }`
Erros: `404 INCOME_NOT_FOUND`, `409 MONTH_CLOSED`, `422 DATE_OUTSIDE_MONTH`

### DELETE /incomes/:id
204 | `404 INCOME_NOT_FOUND` | `409 MONTH_CLOSED`

### PATCH /incomes/templates/:id/deactivate
Para de gerar esta receita recorrente a partir do próximo fechamento (não apaga instâncias já criadas).
200 → `{ template }`

---

## Expenses (Despesas — fixa e variável)

Todas exigem autenticação.

### GET /expenses?monthId=123&type=priority|fixed|variable|card
Lista despesas do mês (todos os tipos, ou filtradas por `type`). Antes de listar, recalcula automaticamente o status `late` de itens vencidos e não pagos.
200 → `{ expenses }`

### POST /expenses/variable
Body: `{ monthId, description, value, categoryId, date, paymentMethod, paid?, observation? }`
`paid` (default `true`) — nasce já paga, pois normalmente representa um gasto que já aconteceu.
201 → `{ expense }`

### POST /expenses/fixed
Body: `{ monthId, description, value, categoryId, dueDay, observation? }`
Cria o `fixed_expense_template` (usado no Fechamento Mensal para repetir nos próximos meses) e a primeira instância, já com status `pending`.
201 → `{ expense }`

### PATCH /expenses/fixed/templates/:id/deactivate
Para de gerar esta despesa fixa a partir do próximo fechamento.

### PATCH /expenses/:id · DELETE /expenses/:id
Só permitido para despesas `fixed`/`variable` em mês aberto. Despesas `priority` (dívida) e `card` (parcela de cartão) retornam `409 EXPENSE_TYPE_NOT_EDITABLE` — devem ser geridas pela dívida/fatura de origem.

### POST /expenses/:id/pay
Body: `{ amount, paymentMethod }`
Permitido mesmo em mês fechado (pagar uma conta atrasada é uma ação legítima — ver `expenses.service.js`). Para despesas `priority`, delega ao módulo `debts` (pagamento flexível). Para `fixed`/`variable`, exige valor exato.
200 → `{ expense, debt }` (`debt` é `null` exceto para despesas de prioridade)
Erros: `409 EXPENSE_ALREADY_PAID`, `409 PAY_VIA_INVOICE` (cartão), `422 EXACT_PAYMENT_REQUIRED`

---

## Debts (Dívidas / Despesas de Prioridade — Etapas 9 e 10)

### GET /debts
200 → `{ debts }` — cada item inclui `valuePaid`, `installmentsGenerated`, `installmentsRemaining` calculados.

### POST /debts
Body: `{ monthId, description, categoryId, totalValue, installmentsCount, flexiblePayment, dueDay }`
Cria a dívida (contrato) e a primeira parcela como `expense` tipo `priority` no mês informado. O valor de cada parcela é sempre recalculado a partir do saldo devedor real (`debts.service.computeInstallmentValue`) — a última parcela absorve qualquer resíduo de arredondamento ou excedente de pagamento, garantindo quitação exata.
201 → `{ debt, expense }`

Pagamento de parcelas de dívida acontece via `POST /expenses/:id/pay` (ver acima). Pagar menos que a parcela só é aceito se `flexiblePayment: true`; pagar mais abate o saldo devedor e pode quitar a dívida antecipadamente (`debt.status` vira `settled`).

---

## Cards (Cartões, Compras Parceladas e Faturas — Etapa 11)

### GET /cards
200 → `{ cards }` — cada cartão inclui `usedLimit` e `availableLimit` calculados (soma de parcelas em aberto).

### POST /cards
Body: `{ name, color?, limitValue, closingDay, dueDay }`

### PATCH /cards/:id · PATCH /cards/:id/deactivate

### POST /cards/:id/purchases
Body: `{ description, categoryId, totalValue, installmentsCount?, purchaseDate }`
Bloqueia se `totalValue` exceder o limite disponível. Gera automaticamente uma fatura (`card_invoices`) e um mês (`months`) para cada parcela futura, se ainda não existirem.
201 → `{ purchase, expenses }`
Erros: `409 INSUFFICIENT_LIMIT`, `409 CARD_INACTIVE`

### GET /cards/:id/invoices
200 → `{ invoices }`

### POST /cards/invoices/:invoiceId/pay
Body: `{ paymentMethod }`
Quita em bloco todas as parcelas da fatura. Não cria nova dívida — a dívida já existe desde a compra.
200 → `{ invoice }`
Erros: `409 INVOICE_ALREADY_PAID`

---

## Savings (Saldo Guardado — Etapa 12)

### GET /savings
200 → `{ balance, transactions }`

### POST /savings/deposit · POST /savings/withdraw
Body: `{ value, date, observation? }`
201 → `{ transaction }`
Erros (withdraw): `409 INSUFFICIENT_SAVINGS_BALANCE`

Observação de design: depósito/retirada impacta o saldo atual/projetado do mês em que ocorre (ver Dashboard) — o dinheiro "sai do bolso" para a reserva, não existe nos dois lugares ao mesmo tempo.

---

## Goals (Metas — Etapa 13)

### GET /goals
200 → `{ goals }` — cada item inclui `progress`, `remaining`, `percentage`, `estimatedMonthsAtCurrentPace` (baseado na média de aportes dos últimos 3 meses).

### POST /goals
Body: `{ name, description?, targetValue, targetDate? }`

### PATCH /goals/:id
Body parcial de `name, description, targetValue, targetDate`.

### POST /goals/:id/contributions
Body: `{ monthId, value, date }`
Permitido mesmo em mês fechado (mesma lógica do pagamento de despesas — é um evento novo). O valor é descontado do saldo atual do mês informado.
201 → `{ contribution }`

### POST /goals/:id/cancel
Body: `{ refundContributions, monthId? }`
Se `refundContributions: true`, devolve o total já aportado como uma entrada no mês atual (ou no `monthId` informado) — nunca reabre os meses originais dos aportes.
200 → `{ goal, refund }`

---

## Dashboard (Etapa 14)

### GET /dashboard?monthId=123
Consolida tudo do mês selecionado: `incomeTotal, expensesPlanned, expensesPaid, currentBalance, projectedBalance, savingsBalance, physicalCash, digitalCash, totalActiveDebt, pendingExpensesCount, upcomingDueDates, cards, goals`.
`financialHealthScore` e `alerts` retornam `null`/`[]` nesta entrega (módulos ainda não implementados).

`physicalCash`/`digitalCash` são saldos acumulados de todos os tempos (como uma carteira), diferente de `currentBalance`/`projectedBalance` que são escopados ao mês selecionado — distinção documentada no código.

---

## Fechamento Mensal (Etapa 15)

### GET /months/:id/closing-preview
Resumo antes de fechar: pendências, faturas em aberto, metas ativas, o que será gerado no próximo mês.
200 → `{ month, pendingExpensesCount, pendingExpensesTotal, openInvoicesCount, activeGoalsCount, willGenerateNextMonth }`

### POST /months/:id/close
Executa o fechamento dentro de uma única transação com lock de linha (`SELECT ... FOR UPDATE`), à prova de duplo clique/retry. Cria o próximo mês e gera automaticamente: receitas recorrentes ativas, despesas fixas ativas, próxima parcela de cada dívida ativa (via `debts.generateNextInstallment`). Compras de cartão não precisam de ação aqui — todas as parcelas já foram criadas no momento da compra.
200 → `{ closedMonth, nextMonth, generated: { incomes, fixedExpenses, debtInstallments } }`
Erros: `409 MONTH_ALREADY_CLOSED`

---

## Financial Health (Saúde Financeira — Módulo 1)

### GET /financial-health?monthId=123
Sempre recalcula na hora (nunca serve cache obsoleto). Persiste o resultado em `financial_health_scores` (histórico mensal).
200 → `{ score, breakdown, computedAt }`

`breakdown` contém um objeto por fator (`reserve, incomeVsExpense, noLate, cardUsage, debt, goals`), cada um com `points`, `max` e `reason` em texto explicando a nota — nenhum cálculo é uma caixa-preta. Fórmulas e limiares (6 meses de reserva, 5x renda de dívida etc.) estão comentados em `financialHealth.service.js`.

---

## Alerts (Alertas Inteligentes — Módulo 2)

### GET /alerts?monthId=123
Recalcula as regras na hora e sincroniza o banco: alertas que pararam de ser válidos viram `resolvedAt` preenchido (não são apagados — preserva histórico); os que continuam ou passaram a valer são upsertados sem duplicar (chave única `user+mês+tipo`).
200 → `{ alerts }` — cada item tem `type, severity, message, createdAt, resolvedAt`.

Regras implementadas (todas matemáticas, sem IA): limite de cartão ≥80%/≥95%, queda de receita ≥15% vs. mês anterior, aumento de despesas ≥20% vs. mês anterior, meta sem aporte há 60+ dias, dívida nova superando pagamento de dívida no mês, despesas > receita, margem financeira <10%, contas atrasadas, reserva financeira <1 mês de despesas.

---

## Próximos módulos (ainda não implementados nesta entrega)

simulators (compras e "e se?") · projections (12/24 meses) · recomendações automáticas · análise comportamental · histórico financeiro comparativo (3/6/12 meses) · reports (PDF).
