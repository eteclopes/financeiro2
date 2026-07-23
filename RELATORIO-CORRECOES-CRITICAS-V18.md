# FinançasHub V18 — Fechamento, cartão e responsividade móvel

## Objetivo

Esta versão corrige os erros observados em produção no fechamento do mês, melhora a renovação de sessão, centraliza a regra do ciclo do cartão e elimina problemas de notificações e tabelas em telas pequenas.

A V18 foi criada sobre a V17 e preserva as funcionalidades financeiras, caixinhas, Plano Pro, internacionalização e proteções de segurança existentes.

## 1. Fechamento de mês e erro Prisma P2028

### Problema observado

O endpoint `POST /api/months/:id/close` ultrapassava o limite padrão de aproximadamente 5 segundos das transações interativas do Prisma. O mês podia aparecer fechado enquanto a geração do período seguinte ficava incompleta, sem receitas recorrentes, despesas fixas ou parcelas de dívidas.

### Correções

- Transação configurada com `maxWait: 10_000` e `timeout: 30_000`.
- Bloqueio transacional por usuário e por linha do mês para impedir dois fechamentos simultâneos.
- Consultas de templates e lançamentos existentes executadas em lote.
- Receitas recorrentes e despesas fixas comuns inseridas em lote.
- Contagem das parcelas de dívidas feita em uma consulta agrupada, evitando uma consulta por dívida.
- O mês só recebe o status `closed` depois que toda a geração do mês seguinte termina.
- Se qualquer etapa falhar, a transação é revertida e o mês aberto não fica fechado pela metade.
- Um P2028 agora retorna um erro específico e compreensível (`MONTH_CLOSE_TIMEOUT`).

### Reparo do mês já afetado

Um mês que já está fechado pode ser processado novamente em modo de reparo. O sistema:

- identifica o mês seguinte;
- encontra apenas receitas recorrentes, despesas fixas e parcelas de dívidas ausentes;
- cria somente o que falta;
- preserva lançamentos existentes;
- não reabre nem fecha novamente o mês;
- registra a ação como `repair_close` na auditoria.

No frontend, o mês fechado exibe a ação **Reparar mês**.

Procedimento após o deploy:

1. Selecione o mês anterior que ficou fechado incompletamente.
2. Abra o Dashboard desse mês.
3. Clique em **Reparar mês**.
4. Confira a prévia do que está faltando.
5. Confirme em **Verificar e reparar**.
6. Abra o mês seguinte e confira receitas recorrentes, despesas fixas e parcelas.

## 2. Regra do cartão de crédito

A regra foi centralizada em `backend/src/utils/cardCycle.js`, evitando divergência entre compras, planejamento e simuladores.

Para um cartão que fecha no dia 18 e vence no dia 28:

- compra feita até o dia 18, inclusive: vence no dia 28 do mesmo mês;
- compra feita depois do dia 18: entra na fatura seguinte e vence no dia 28 do mês seguinte.

Casos testados:

- compra em 18/07/2026 → vencimento em 28/07/2026;
- compra em 19/07/2026 → vencimento em 28/08/2026.

Também foi mantido o caso em que o vencimento ocorre antes do fechamento. Exemplo: fechamento 28, vencimento 5, compra após 28/07 → vencimento em 05/09.

O formulário de compra agora explica a regra conforme os dias configurados no cartão.

## 3. Corrida de refresh token

### Problema observado

Várias abas ou deployments de preview podiam tentar renovar o mesmo refresh token simultaneamente. A primeira requisição recebia 200 e revogava o token; as seguintes recebiam 401 e podiam desconectar abas legítimas.

### Correções

- Janela curta de 10 segundos para concorrência legítima entre renovações simultâneas.
- Reutilização fora dessa janela continua sendo rejeitada.
- Bootstrap e interceptor do frontend compartilham a mesma Promise de refresh na página.
- Rajadas de renovação dentro da mesma página são consolidadas.

## 4. Logs de produção

O logger agora usa a rota original sem query string. Em vez de registrar várias chamadas apenas como `GET /`, passa a indicar corretamente rotas como `/api/months/31/close`, sem expor os parâmetros da query ou dados financeiros.

## 5. Notificações no celular

O painel de notificações:

- fica contido entre as margens da tela;
- respeita safe areas;
- usa altura máxima baseada no viewport dinâmico;
- possui rolagem interna controlada;
- não ultrapassa a largura ou a altura da tela;
- continua como dropdown normal no desktop.

## 6. Receitas, despesas e outras tabelas no celular

As tabelas financeiras relevantes viram cartões verticais abaixo de 640 px. Cada valor mantém seu rótulo, sem exigir rolagem lateral.

Telas cobertas:

- Receitas;
- Despesas fixas e variáveis;
- Faturas dos cartões;
- Histórico;
- Relatórios de metas e cartões;
- Reservas;
- Tendências.

No desktop, as tabelas continuam no formato tradicional.

## 7. Banco de dados

A V18 não altera o `schema.prisma` e não adiciona migration.

Não há mudança em tabelas, colunas, valores financeiros ou relacionamentos. O reparo usa as estruturas e identificadores já existentes.

## 8. Arquivos principais alterados

Backend:

- `src/modules/closing/closing.service.js`
- `src/modules/debts/debts.service.js`
- `src/modules/cards/cardPurchases.service.js`
- `src/modules/planning/planning.service.js`
- `src/modules/auth/auth.service.js`
- `src/middlewares/security.js`
- `src/utils/cardCycle.js`

Frontend:

- `src/components/dashboard/QuickActions.jsx`
- `src/components/layout/Topbar.jsx`
- `src/lib/api.js`
- `src/store/authStore.js`
- `src/pages/CardsPage.jsx`
- `src/pages/IncomesPage.jsx`
- `src/pages/ExpensesPage.jsx`
- `src/pages/HistoryPage.jsx`
- `src/pages/ReportsPage.jsx`
- `src/pages/SavingsPage.jsx`
- `src/pages/TrendsPage.jsx`
- `src/index.css`
- arquivos de internacionalização.

## 9. Validações realizadas

- Sintaxe de todos os arquivos JavaScript do backend analisada com `node --check`.
- 72 arquivos JS/JSX/MJS do frontend analisados, sem erros de sintaxe.
- CSS processado sem erro.
- 592 imports relativos verificados, sem arquivos ausentes.
- Arquivos JSON validados.
- Testes estáticos existentes de tutorial, i18n, formulários, segurança e pagamentos aprovados.
- Verificação específica da responsividade V18 aprovada.
- Verificação específica de fechamento, reparo, sessão, logger e ciclo do cartão aprovada.
- Fluxos V16 de caixinhas e calculadoras continuaram aprovados.
- Nenhum segredo real foi encontrado no projeto.

O build completo do Vite, a suíte Jest e `prisma validate` não foram executados neste ambiente porque as dependências do projeto não estavam instaladas. Devem ser executados no pipeline de deploy.

## 10. Ordem recomendada de deploy

1. Fazer backup do banco.
2. Publicar o backend V18 primeiro.
3. Confirmar que a API iniciou normalmente.
4. Publicar o frontend V18.
5. Reparar o mês que ficou incompleto.
6. Testar uma compra no dia do fechamento e outra no dia seguinte.
7. Testar login/refresh com apenas o domínio principal aberto.
8. Testar notificações, receitas e despesas em uma tela de 320–390 px.

Não é necessário executar migration para a V18.
