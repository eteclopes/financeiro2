# Entrega — Módulos 1 e 2 (Saúde Financeira + Alertas)

## 1. Análise de impactos

Nenhuma tabela, service, controller ou rota existente foi alterado em comportamento. As únicas mudanças em código já existente foram: (a) `dashboard.service.js` — os campos `financialHealthScore: null` e `alerts: []` (deixados como placeholder explícito desde a Etapa 14) passaram a chamar os novos services; (b) `routes/index.js` — duas linhas novas de `router.use(...)`. Nenhuma regra financeira (parcelamento, pagamento flexível, fechamento de mês, etc.) foi tocada.

## 2. Alterações necessárias no banco

Uma única tabela alterada: `alerts`. Adicionada a coluna `resolved_at` (nullable) e uma chave única `(user_id, month_id, type)`. Sem isso não era possível implementar o status "ativo/resolvido" pedido nem evitar duplicação de alertas a cada vez que o dashboard é carregado. Script incremental para quem já tinha o banco criado: `backend/prisma/migration-002-alerts.sql`. Quem for criar o banco do zero usa o `database.sql` da raiz, já atualizado.

## 3. Novas tabelas

Nenhuma. Reaproveitadas `alerts` (alterada, ver item 2) e `financial_health_scores` (já existia desde a Etapa 2/4, só não tinha nenhum service escrevendo nela ainda).

## 4. Novos services

`financialHealth.service.js` (motor de pontuação 0–100) e `alerts.service.js` (motor de regras). Ambos reutilizam `cardsService.computeUsedLimit`, `savingsService.getCurrentBalance` e `monthsService.getMonthOrThrow` em vez de duplicar consultas — única lógica nova é o cálculo dos 6 fatores de saúde financeira e a avaliação das 9 regras de alerta.

## 5. Novos controllers

Não há controllers separados — seguindo o padrão já usado em `months`/`dashboard`, os handlers ficam direto no arquivo de rotas (módulos pequenos e somente leitura não precisam da camada extra).

## 6. Novas rotas

`GET /api/financial-health?monthId=` · `GET /api/alerts?monthId=`. Documentadas em `docs/API.md`.

## 7. Alterações no dashboard

`GET /api/dashboard` agora retorna `financialHealthScore` e `alerts` preenchidos de verdade (antes retornava `null`/`[]`). Nenhum outro campo do dashboard mudou de formato.

## 8. Implementação completa dos módulos

Módulos 1 e 2 completos conforme especificado (pontuação explicável por fator, alertas com severidade/data/status). Módulos 3 a 9 do prompt ainda não foram implementados — ver próxima entrega.

## 9. Testes necessários (checklist manual — sem framework de teste configurado ainda)

Saúde financeira: usuário sem nenhum dado (deve dar nota neutra alta, não erro); usuário com reserva zero e despesas altas (nota baixa no fator reserva); usuário sem cartões ativos (fator cartão = 15 cheio, não 0); usuário sem metas ativas (fator metas = 10 cheio, não 0); conferir que `score` nunca passa de 100 nem fica negativo.

Alertas: cartão passando de 79%→81% gera alerta uma única vez (não duplica em chamadas repetidas); cartão voltando para 70% marca o alerta anterior como resolvido (`resolvedAt` preenchido), sem apagar a linha; mês sem mês anterior (primeiro mês do usuário) não quebra as regras de comparação (`previousIncome`/`previousExpenses` tratados como ausentes, não como zero-é-queda-de-100%); 3+ contas atrasadas vira severidade `critical` em vez de `warning`.

## 10. Revisão final — riscos e possíveis bugs já identificados

`gatherMetrics`/`gatherContext` fazem várias queries em paralelo mas não estão dentro de uma transação — em um sistema com múltiplos usuários simultâneos isso é aceitável (são leituras, não escritas conflitantes), mas o `refreshAlerts` faz upsert dentro de transação justamente para evitar duplicação em escrita concorrente. A regra "dívida crescendo" é uma aproximação matemática (dívida nova do mês vs. pago em dívida no mês) — não é um histórico mês a mês do saldo devedor total, porque essa série temporal não existe no modelo atual; documentado no código. Both services recalculam tudo a cada chamada (sem cache) — funciona bem na escala de um usuário; se o dashboard for chamado com muita frequência por muitos usuários, vale revisar para um cache curto (ex.: 1 minuto) na auditoria final (Etapa 20).
