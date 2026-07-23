# V14 — Correção de saldo, datas dos formulários e erros em modais

## Problemas corrigidos

### 1. Receita não entrava imediatamente no saldo

O saldo disponível usava `incomeDate <= hoje`. Isso fazia uma receita salva com data posterior, ou uma receita recorrente gerada ao fechar o mês, aparecer nos totais/projeções sem entrar no saldo disponível.

A partir da V14:

- Toda receita persistida entra imediatamente no saldo disponível.
- `incomeDate` continua servindo para organização, histórico e relatórios mensais.
- Receitas recorrentes geradas durante o fechamento já aparecem no saldo do novo mês.
- Reduzir ou excluir uma receita continua protegido contra saldo negativo.
- Meses fechados continuam usando o saldo histórico do período.

### 2. Formulários puxavam o mês do computador

Os formulários criavam datas com o relógio local, mesmo quando o usuário estava trabalhando em outro mês financeiro. Isso causava `DATE_OUTSIDE_MONTH` depois de fechar ou trocar o período.

A partir da V14:

- Ano e mês da data padrão vêm do mês selecionado no sistema.
- O dia é ajustado automaticamente e limitado ao último dia do período.
- Inputs ligados ao mês financeiro recebem `min` e `max` do mês selecionado.
- A correção cobre:
  - Receita na página completa.
  - Receita nas ações rápidas.
  - Despesa variável na página completa.
  - Despesa variável nas ações rápidas.
  - Compra no cartão.
  - Aporte em meta na página completa.
  - Aporte em meta nas ações rápidas.
- Edições de receitas/despesas preservam a data existente e não permitem trocar para outro período por engano.

### 3. Erros apareciam atrás do formulário

O `ToastContainer` estava dentro da árvore visual do app, enquanto os modais usam Portal no `document.body`. O z-index do toast não conseguia escapar do contexto de empilhamento do layout.

A partir da V14:

- Toasts também usam Portal no `document.body`.
- A camada de notificações usa z-index global acima dos modais.
- Durante um modal aberto, notificações ficam no topo da tela.
- Erros usam `role="alert"` para melhor acessibilidade.
- Os avisos não ficam atrás do painel e não cobrem os botões fixos no rodapé.

## Arquivos principais alterados

### Backend

- `backend/src/modules/_shared/balance.js`
- `backend/src/modules/dashboard/dashboard.service.js`
- `backend/src/modules/incomes/incomes.service.js`
- `backend/tests/services/balance.service.test.js`

### Frontend

- `frontend/src/lib/date.js`
- `frontend/src/components/ui/Toast.jsx`
- `frontend/src/components/dashboard/QuickActions.jsx`
- `frontend/src/pages/IncomesPage.jsx`
- `frontend/src/pages/ExpensesPage.jsx`
- `frontend/src/pages/CardsPage.jsx`
- `frontend/src/pages/GoalsPage.jsx`
- `frontend/src/index.css`
- `frontend/scripts/check-ledger-form-safety.mjs`

## Validações executadas

- Parser JS/JSX em 60 arquivos do frontend: aprovado.
- `node --check` em todos os arquivos JavaScript do backend: aprovado.
- 251 imports relativos do frontend verificados: nenhum ausente.
- `npm run check:ledger-forms`: aprovado.
- `npm run check:i18n`: aprovado.
- `npm run check:tutorial`: aprovado.
- Verificação funcional isolada de `getAvailableBalance`: aprovada.
- JSON do `package.json`: aprovado.

## Limitação do ambiente

A suíte Jest e o build Vite completos não puderam ser executados porque as dependências não estavam instaladas e o cache offline não continha todos os pacotes necessários (`zod` ausente no cache).
