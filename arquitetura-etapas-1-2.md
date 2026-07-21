# Sistema de Gestão Financeira Pessoal Inteligente
## Documento de Arquitetura — Etapa 1 (Funcional) e Etapa 2 (Modelagem de Banco)

> Sem código, sem SQL, sem Prisma ainda — conforme o processo que você definiu. Este documento cobre apenas entendimento do sistema e modelagem conceitual. Etapas 3 (database.sql) e 4 (schema.prisma) dependem da sua aprovação do que está aqui.

---

## 0. Pontos que precisam da sua confirmação

Identifiquei algumas zonas cinzentas nas regras oficiais que afetam diretamente a modelagem. Estou assumindo uma resposta padrão para cada uma — me avise se quiser outra:

1. **Aporte em saldo guardado abate do saldo atual?** A regra diz isso explicitamente para metas ("o valor deve ser descontado do saldo atual"), mas não diz isso para saldo guardado. Estou assumindo que sim — depositar no saldo guardado é uma saída de caixa do mês corrente, senão o dinheiro existiria "duplicado" (no saldo atual e no guardado ao mesmo tempo). Retirar do guardado faz o caminho inverso (entra no saldo atual do mês da retirada).
2. **Pagamento de fatura do cartão: em qual mês ele impacta o saldo atual?** Estou assumindo que cada parcela/compra do cartão já é uma despesa "prevista" no mês de referência da fatura (independente de quando você efetivamente paga), e o pagamento da fatura apenas muda o status dessas despesas de Pendente/Atrasado para Pago. Isso mantém a regra "saldo atual = receitas − despesas efetivamente pagas" consistente por mês.
3. **Pagamento acima da parcela com quitação antecipada:** quando o excedente abate parcelas futuras a ponto de zerar o saldo devedor antes do número de parcelas previsto, as parcelas futuras "sobrando" são removidas (não viram parcelas de R$0) e a dívida muda para status Quitada.
4. **Dinheiro físico não pode ficar negativo?** Vou tratar isso como um alerta ("saldo físico insuficiente"), não como bloqueio, porque bloquear cadastro de despesa por causa de caixa físico é uma regra de UX agressiva demais para o estágio atual — mas é configurável depois.

Se algum desses pontos estiver errado, é só corrigir antes de eu seguir para Etapa 3.

---

## ETAPA 1 — ARQUITETURA FUNCIONAL

### 1. Visão geral

O sistema é uma plataforma financeira pessoal organizada em torno do conceito de **mês como unidade de trabalho**. Cada mês é, na prática, um snapshot fechado de receitas, despesas, faturas e indicadores — uma vez encerrado, ele nunca é recalculado retroativamente por alterações futuras. Tudo o que é recorrente (salário, aluguel, parcelas, assinaturas) existe como um "modelo" (template) que gera instâncias mensais independentes no fechamento.

### 2. Objetivos

Controlar entradas e saídas com granularidade total (inclusive por forma de pagamento físico/digital), automatizar a repetição de receitas e despesas recorrentes sem duplicação, garantir que parcelamentos e pagamentos flexíveis nunca distorçam o saldo do mês, e fornecer simulações e projeções que ajudem na tomada de decisão — tudo isso com regras de negócio determinísticas e auditáveis, sem IA externa, e com isolamento total de dados entre usuários.

### 3. Arquitetura conceitual

Arquitetura em camadas, cliente-servidor: SPA React consumindo uma API REST stateless protegida por JWT. O backend segue separação Controller → Service → Repository, com Zod validando todo payload na borda e Prisma isolando o acesso a dados. A unicidade do isolamento multiusuário é garantida em uma única camada (repository/middleware), nunca deixada a cargo de cada controller individualmente — esse é o ponto de maior risco de vazamento de dados entre usuários, então centralizar essa regra (todo `findMany`/`update`/`delete` passa por um filtro obrigatório `user_id`) é uma decisão arquitetural, não um detalhe.

A "engine" de cálculos financeiros (saldo atual, saldo projetado, saúde financeira, alertas) deve ser um módulo de domínio puro, sem dependência direta de Express/Prisma, para ser testável isoladamente e reaproveitável pelo simulador "E se?" (que precisa rodar os mesmos cálculos sobre dados hipotéticos, sem persistir nada).

### 4. Módulos do sistema

Autenticação · Receitas · Despesas (Prioridade / Fixa / Variável / Cartão) · Cartões e Faturas · Saldo Guardado · Metas · Dashboard · Fechamento Mensal · Saúde Financeira · Alertas · Simulador de Compras · Simulador "E se?" · Projeção Financeira · Relatórios.

### 5. Fluxo completo do usuário

Login → seleção/abertura do mês corrente → Dashboard do mês → navegação livre entre os módulos (lançar receita, despesa, aporte em meta, movimentar saldo guardado, registrar compra no cartão) → consulta de simuladores a qualquer momento → ao final do mês, ação explícita de Fechamento Mensal, que gera o próximo mês e arquiva o atual como histórico imutável.

### 6. Receitas (incluindo recorrência)

Cada receita pertence a um mês específico e carrega forma de pagamento (física/digital/PIX/etc.), categoria, valor e data. Receitas recorrentes são, na prática, duas entidades: um **template** (cadastrado uma vez, com valor "padrão") e uma **instância mensal** gerada a partir dele no fechamento. Isso é o que permite que você altere o valor do salário em março sem mudar o que já estava registrado em janeiro.

*Regras obrigatórias:* toda receita pertence a exatamente um mês; alterar o template não altera instâncias passadas; desativar um template para de gerar novas instâncias mas não apaga as existentes.
*Riscos/bugs futuros:* editar uma instância gerada (achar que está editando o template) e achar que isso "corrigiu" o mês seguinte também — UI precisa deixar claro qual dos dois está sendo editado. Receita recorrente com valor variável (ex.: freelance) sendo tratada como fixa por engano.
*Validações:* valor > 0, data dentro do mês selecionado, categoria existente (padrão ou do usuário).

### 7. Despesas Prioridade, Parcelamento e Pagamento Flexível

Esses três conceitos são uma única máquina de estados, então trato como um fluxo só. Uma despesa de prioridade nasce como um "contrato de dívida" (valor total, nº de parcelas, se é flexível) e gera, mês a mês, **uma instância de despesa correspondente a uma parcela** — nunca o valor total. O pagamento dessa instância pode ser exato, parcial (sobra vai para a próxima parcela) ou maior que o previsto (excedente abate parcelas futuras, recalculando saldo devedor e podendo antecipar quitação).

*Regras obrigatórias:* o dashboard nunca soma o valor total da dívida, só a parcela do mês corrente; o saldo devedor é recalculado a cada pagamento, nunca recomputado do zero a partir do histórico (isso evita inconsistência se um pagamento antigo for corrigido); ao quitar antecipadamente, parcelas futuras já geradas são removidas/marcadas como canceladas, não deixadas como "parcela de R$0".
*Riscos/bugs futuros:* arredondamento da divisão valor/parcelas (R$1000 ÷ 3 = R$333,33 repetindo — a soma das parcelas pode não bater com o total se não tratar o resto na última parcela); pagamento duplo no mesmo mês sendo somado errado; condição de corrida se dois requests de pagamento chegarem simultaneamente (precisa de transação com lock na linha da dívida).
*Validações:* pagamento não pode ser negativo; dívida flexível precisa estar marcada como tal antes de aceitar pagamento parcial (senão deveria virar "Atrasado" + saldo residual, e não silenciosamente acumular).

### 8. Despesas Fixas

Funcionam de forma simétrica às receitas recorrentes: um template gera uma instância por mês no fechamento. Diferem das despesas de prioridade por não terem parcelas nem saldo devedor — é só "o mesmo valor, todo mês", editável e desativável sem apagar histórico.

*Regras obrigatórias:* desativar o template impede geração futura mas preserva instâncias já criadas; editar o valor do template só afeta meses futuros.
*Riscos:* usuário esperar que desativar uma assinatura no meio do mês remova a despesa já lançada naquele mês — precisa ser explícito que a desativação vale a partir do próximo fechamento.

### 9. Despesas Variáveis

Sem template — cada lançamento é independente e fica para sempre como está (mercado, padaria, lanche). É o tipo de despesa com menor complexidade de regras, mas o maior volume de linhas no banco, então é o candidato natural a paginação/índices agressivos por mês+categoria.

*Validações:* mesmas de uma despesa comum (valor, categoria, data dentro do mês).

### 10. Cartões de Crédito e Faturas

Cada cartão tem dia de fechamento e vencimento próprios. Uma compra parcelada gera N parcelas, cada uma associada à fatura do mês em que ela "cai" (compra antes do fechamento → fatura atual; depois → próxima). Pagar a fatura não cria uma nova dívida — apenas muda o status das despesas que compõem aquela fatura para Pago, atualiza limite disponível e saldo atual.

*Regras obrigatórias:* o limite disponível é sempre `limite − soma das parcelas futuras em aberto`, nunca só "o que falta pagar este mês"; a data de corte de fechamento decide a fatura de destino, não a data de compra "redonda" por mês civil.
*Riscos/bugs futuros:* compra feita exatamente no dia de fechamento (regra de borda: inclusivo ou exclusivo?); cartão cancelado/desativado com parcelas futuras pendentes — não pode simplesmente sumir do sistema; pagamento parcial de fatura (a regra atual não cobre isso explicitamente — recomendo tratar como pagamento flexível também, item por item dentro da fatura).
*Validações:* compra não pode exceder limite disponível (ou ao menos gerar alerta forte, já que cartões reais às vezes permitem estourar limite).

### 11. Saldo Guardado

Reserva financeira que não entra no cálculo de saldo atual/projetado, mas (conforme decisão do item 0.1) afeta o saldo atual no momento do depósito/retirada, pois o dinheiro precisa "vir de algum lugar". O valor é cumulativo e sobrevive a fechamentos de mês sem reset.

*Regras obrigatórias:* todo depósito/retirada gera um registro de histórico imutável; o saldo é a soma de todas as movimentações, nunca um campo editável diretamente.

### 12. Dinheiro Físico vs. Digital

Toda movimentação (receita ou despesa) carrega uma forma de pagamento. O saldo físico é a soma de receitas físicas menos despesas pagas em dinheiro físico; o saldo digital é o espelho disso para as demais formas. Isso é, na prática, um segundo "saldo atual" segmentado por forma de pagamento.

*Riscos:* usuário trocar dinheiro físico por digital (sacar/depositar) sem que exista uma transação para isso no sistema — os dois saldos podem ficar artificialmente errados. Vale considerar, no futuro, uma transação de "transferência interna" entre físico e digital.

### 13. Metas

Independentes do ciclo mensal — não são "fechadas" junto com o mês. Cada aporte é uma transação com data, que (a) soma no progresso da meta e (b) debita do saldo atual do mês em que ocorreu. Cancelamento oferece a opção de devolver os aportes ao saldo atual.

*Regras obrigatórias:* a meta nunca expira automaticamente; o cálculo de "prazo estimado" é uma projeção simples (valor faltante ÷ média de aporte mensal dos últimos N meses), exibida como sugestão, não como compromisso.
*Riscos:* devolver aportes ao cancelar uma meta cujos meses de origem já foram fechados — a devolução deve cair no mês corrente, nunca reabrir um mês passado.

### 14. Fechamento Mensal

A operação mais sensível do sistema. Antes de fechar, mostra um resumo de pendências (parcelas, faturas, contas em aberto). Ao confirmar, em uma única transação de banco: cria o próximo mês, gera as instâncias de receitas recorrentes, despesas fixas, próxima parcela de cada dívida ativa e próxima fatura/parcelas de cartão, e mantém saldo guardado e metas intocados (são entidades contínuas, não mensais). Pendências do mês anterior (parcelas não pagas, faturas não pagas) permanecem nele mesmo — não são "puxadas" para o novo mês como duplicata, apenas continuam aparecendo como Atraso até serem pagas.

*Regras obrigatórias:* idempotência — fechar o mesmo mês duas vezes (duplo clique, retry de rede) não pode gerar duplicação; tudo dentro de uma transação com rollback automático em caso de falha parcial.
*Riscos/bugs futuros:* esse é o ponto de maior risco de bug de duplicação do sistema inteiro — recomendo fortemente um lock (`SELECT ... FOR UPDATE` ou constraint única `(user_id, mês, ano)`) impedindo dois fechamentos simultâneos do mesmo usuário.

### 15. Saúde Financeira

Score 0–100 calculado a partir de seis fatores com pesos fixos no MVP (reserva, receita > despesa, ausência de atrasos, uso de cartão, endividamento, cumprimento de metas), com a fórmula de cada fator documentada e exibida ao usuário (nunca uma "caixa-preta"). Recalculado a cada fechamento e disponível sob demanda para o mês corrente.

### 16. Alertas Inteligentes

Motor de regras simples (thresholds configuráveis) rodando sobre os dados já calculados do mês — sem IA. Cada alerta tem um tipo, severidade e mensagem gerada por template. Importante: alertas devem ser recalculados, não acumulados infinitamente (um alerta de "cartão em 80%" não deve gerar uma nova linha toda vez que o dashboard é aberto).

### 17. Simuladores (Compras e "E se?")

Ambos rodam a mesma engine de cálculo de saldo projetado/comprometimento de renda usada no dashboard, mas sobre dados hipotéticos em memória — nunca gravam nada no banco até o usuário decidir efetivar. Esse reaproveitamento de lógica (módulo de domínio puro, mencionado na arquitetura conceitual) é o que evita ter duas implementações divergentes da mesma fórmula de saldo.

### 18. Projeção Financeira (12 meses)

Projeta meses futuros aplicando os templates ativos (receitas recorrentes, despesas fixas) e o cronograma já conhecido de parcelas (dívidas e cartão) sem necessidade de o usuário ter "fechado" esses meses ainda — é uma simulação de leitura, não uma criação de registros reais.

### 19. Relatórios

Agregações sobre dados já existentes (mensal, por categoria, por cartão, dívidas, metas, saúde financeira), com exportação em PDF. Não introduz regra de negócio nova — é uma camada de leitura/apresentação sobre tudo o que já foi modelado acima.

---

## ETAPA 2 — MODELAGEM DO BANCO DE DADOS

### Princípio de design

Duas famílias de tabelas: **templates** (configuração recorrente: receita recorrente, despesa fixa, dívida de prioridade, compra de cartão) e **instâncias** (o que de fato aconteceu em um mês específico). Instâncias nunca são recalculadas a partir do template depois de criadas — isso é o que garante o histórico imutável. Todas as tabelas de dados financeiros incluem `user_id` e usam soft delete (`deleted_at`) em vez de exclusão física para entidades com implicação financeira.

### Tabelas principais

**users** — id, name, email (unique), password_hash, created_at, updated_at. Base da autenticação e dono de todos os dados.

**refresh_tokens** — id, user_id (FK), token_hash, expires_at, revoked_at. Suporte a logout real e rotação de sessão.

**password_resets** — id, user_id (FK), token_hash, expires_at, used_at.

**months** — id, user_id (FK), month (1–12), year, status (open/closed), closed_at. Unique constraint `(user_id, month, year)`. É o "container" que dá significado de snapshot a tudo abaixo.

**categories** — id, user_id (nullable — null = categoria padrão do sistema), name, type (income/expense), is_default. Permite categorias padrão compartilhadas e personalizadas por usuário.

**income_templates** — id, user_id, description, value, category_id, payment_method, active, created_at.

**incomes** (instância) — id, user_id, month_id (FK), template_id (nullable), description, value, category_id, payment_method, origin (digital/física), date, observation. Índice em `(user_id, month_id)`.

**fixed_expense_templates** — id, user_id, description, category_id, value, due_day, active.

**debts** (despesas de prioridade — o "contrato") — id, user_id, description, category_id, total_value, installments_count, installment_value, flexible_payment (bool), due_day, status (active/settled), remaining_balance, created_at.

**expenses** (instância única para os 4 tipos: prioridade, fixa, variável, cartão) — id, user_id, month_id (FK), type (priority/fixed/variable/card), description, category_id, due_date, value, paid_amount, status (pending/partial/paid/late/settled), payment_method, fixed_template_id (nullable FK), debt_id (nullable FK — só para tipo priority), card_invoice_id (nullable FK — só para tipo card), card_purchase_id (nullable FK), observation, deleted_at. Índices em `(user_id, month_id)` e `(user_id, status)` para consultas de atraso/pendência.

*Por que uma tabela só para os 4 tipos de despesa, em vez de 4 tabelas separadas?* Porque o dashboard, o saldo atual e os relatórios precisam consultar "todas as despesas do mês" de forma unificada o tempo todo — separar em 4 tabelas obrigaria 4 queries (ou UNIONs) toda vez. As colunas específicas de cada tipo ficam nullable e só preenchidas quando aplicável.

**cards** — id, user_id, name, color, limit_value, closing_day, due_day, active.

**card_purchases** (o "contrato" da compra) — id, user_id, card_id, description, category_id, total_value, installments_count, installment_value, purchase_date, created_at.

**card_invoices** — id, card_id, month_id (FK), reference_month, reference_year, closing_date, due_date, total_value, status (open/closed/paid), paid_at. Unique `(card_id, reference_month, reference_year)`.

**savings_transactions** — id, user_id, type (deposit/withdraw), value, date, observation, balance_after, created_at. Saldo guardado = última `balance_after` ou soma de todas as `value` com sinal.

**goals** — id, user_id, name, description, target_value, target_date (nullable), status (active/completed/cancelled), created_at.

**goal_contributions** — id, goal_id, value, type (contribution/refund), date, month_id (FK — mês em que impactou o saldo atual), created_at.

**alerts** — id, user_id, month_id (FK), type, severity, message, created_at, read_at.

**financial_health_scores** — id, user_id, month_id (FK, unique), score, breakdown_json (detalhamento por fator), created_at.

**audit_log** — id, user_id, entity, entity_id, action, old_value_json, new_value_json, created_at. Cobre a exigência de "cálculos auditáveis" e rastreabilidade completa exigida no prompt original.

### Relacionamentos-chave

`users` 1—N todas as tabelas acima (isolamento multiusuário). `months` 1—N `incomes`, `expenses`, `card_invoices`, `alerts`, `financial_health_scores`. `debts` 1—N `expenses` (cada parcela é uma linha em `expenses` com `type = priority`). `card_purchases` 1—N `expenses` (cada parcela da compra é uma linha em `expenses` com `type = card`, agrupada por `card_invoice_id`). `goals` 1—N `goal_contributions`.

### Índices e constraints recomendados

Unique `(user_id, month, year)` em `months`; unique `(user_id, email)` em `users` (já coberto por unique simples em email global); índice composto `(user_id, month_id, type)` em `expenses` para o dashboard; índice `(user_id, status)` em `expenses` para alertas de atraso; foreign keys com `ON DELETE RESTRICT` em tudo que tem implicação financeira (nunca cascade automático apagando histórico).

---

## Próximos passos

Com isso aprovado (ou ajustado), a Etapa 3 gera o `database.sql` compatível com MySQL/MariaDB/XAMPP a partir exatamente dessas tabelas, seguida da Etapa 4 (`schema.prisma`). Não vou avançar para SQL/Prisma/backend até você confirmar os 4 pontos da seção 0 e validar se essa modelagem (em especial a tabela `expenses` unificada) faz sentido para você.
