# Análise completa do sistema + auditoria dos simuladores

**Data:** julho/2026
**Escopo:** leitura de 100% do código (backend `src/` + frontend `src/`), inventário de funcionalidades, limpeza de manutenibilidade e — o foco principal pedido — uma análise crítica de fundo das lógicas do Simulador "E Se" e do Simulador de Compras, para responder: *isso faz sentido de verdade, ou só parece fazer sentido?*

Este documento é complementar ao `AUDITORIA-CLAUDE.md` e ao `AUDITORIA-FINAL.md` já existentes (que cobriram segurança, race conditions, N+1 e testes). Aquele trabalho continua de pé — o backend estava, de modo geral, bem estruturado e comentado. Esta rodada olhou para um ângulo que ainda não tinha sido auditado: **a matemática financeira em si está certa?**

Resposta curta: não inteiramente. Encontrei um bug real e relativamente sério no motor de projeção (usado por tudo: dashboard, simuladores, `/projections`), e dois problemas de lógica no Simulador "E Se" que faziam ele recomendar decisões financeiras erradas em cenários comuns. Todos os quatro foram corrigidos e têm teste de regressão cobrindo exatamente o cenário que expõe o bug. Detalhes abaixo.

---

## 1. Resumo executivo

| # | Achado | Onde | Severidade | Status |
|---|--------|------|------------|--------|
| 1 | Cronograma de dívida projetado ficava desalinhado em 1 mês (usava o valor da parcela seguinte, não a real do mês atual; a última parcela — normalmente a maior — sumia do horizonte) | `projections.service.js` (motor usado por tudo) | **Alta** | ✅ Corrigido + testado |
| 2 | "Quitar dívida" e "Antecipar parcelas" no simulador "E Se" mostravam só o benefício (parcelas futuras somem) e nunca cobravam o custo (o dinheiro que sai do bolso hoje) | `whatIfSimulator.service.js` | **Alta** | ✅ Corrigido + testado |
| 3 | Dívida inexistente/de outro usuário fazia o cenário "silenciosamente" não fazer nada, em vez de avisar o erro | `whatIfSimulator.service.js` | Média | ✅ Corrigido + testado |
| 4 | "Melhor parcelamento" e "aguardar até" do Simulador de Compras ignoravam o limite do cartão e só testavam pagar à vista (nunca parcelado) ao buscar um mês futuro | `purchaseSimulator.service.js` | Média | ✅ Corrigido + testado |
| 5 | `round2` reimplementado do zero em 12 arquivos diferentes; tratamento de erro do frontend duplicado em ~40 lugares | Backend e frontend inteiros | Manutenibilidade | ✅ Centralizado |
| 6 | Três definições diferentes de "comprometimento de renda" convivem no app (dashboard, saúde financeira, simulador de compras), cada uma com uma fórmula distinta | Cross-cutting | Média (produto) | 📋 Recomendação (não alterado — ver §7) |
| 7 | "Reduzir categoria" e "Cancelar assinatura" no "E Se" são, hoje, o mesmo cálculo — o primeiro nem recebe qual categoria | `whatIfSimulator.service.js` | Baixa (produto) | 📋 Recomendação (não alterado — ver §7) |
| 8 | Componente React definido dentro de outro componente fazia campos de texto perderem o foco a cada tecla digitada (aba "E Se" e mais 3 lugares) | Frontend, 4 arquivos | **Alta** (usabilidade) | ✅ Corrigido |
| 9 | Sino de notificações 100% decorativo (sem `onClick`); faltava alerta para conta perto de vencer (só existia para já atrasada) | Frontend (Topbar) + backend (alerts) | Alta (funcionalidade ausente) | ✅ Corrigido + testado |
| 10 | Barra de busca 100% decorativa (comentário no código já dizia "visual apenas") | Frontend (Topbar) | Alta (funcionalidade ausente) | ✅ Corrigido + testado (endpoint novo) |
| 11 | Fechar o mês não selecionava o mês novo automaticamente (janela de estado incorreto + resposta de dashboard fora de ordem) | Frontend (fechamento de mês) | Média | ✅ Corrigido |

A seção §10 detalha os achados 8–11 (segunda rodada, depois da entrega inicial).

Toda a suíte de testes do backend passa: **116 testes em 18 arquivos** (eram 86 em 14 antes de qualquer alteração — acrescentei 4 arquivos novos de teste e ampliei um quinto, ao longo das duas rodadas). O frontend builda limpo (`npm run build`) depois de todas as mudanças.

---

## 2. O que foi revisado

- **Backend** (`backend/src/`): os 20 módulos (`auth`, `months`, `categories`, `incomes`, `expenses`, `debts`, `cards`, `savings`, `goals`, `dashboard`, `financialHealth`, `alerts`, `projections`, `simulators`, `recommendations`, `behavioralAnalysis`, `history`, `closing`, `auditLog`, `_shared`), middlewares, config e utils — arquivo por arquivo, linha por linha nos módulos com regra de negócio.
- **Frontend** (`frontend/src/`): as 17 páginas, a camada de API (`lib/api.js`, `lib/services/`), stores (Zustand) e os componentes de UI compartilhados.
- **Testes**: os 14 arquivos de teste existentes, para entender o que já era coberto antes de mexer em qualquer coisa.
- Rodei a suíte de testes real (Jest) antes de qualquer alteração para ter uma baseline, e depois de cada mudança, para pegar regressão cedo.

---

## 3. Inventário de funcionalidades

### 3.1 Fundação (meses, categorias, autenticação)
- **Auth**: registro/login com bcrypt, refresh token com rotação e reuse-detection (revoga a família inteira de tokens se um token já usado for reapresentado), recuperação de senha por e-mail com token de uso único, comparação de senha em tempo constante mesmo para e-mail inexistente (mitiga *timing attack* de enumeração de usuário).
- **Meses** (`months`): cada mês do usuário é um registro (`Month`) com status `aberto`/`fechado`; é o eixo central que todo o resto do sistema referencia por `monthId`.
- **Categorias e orçamentos** (`categories`): categorias custom por usuário + limite mensal opcional por categoria (`getBudgetStatus` calcula gasto real vs. limite).

### 3.2 Lançamentos
- **Receitas** (`incomes`): pontuais ou recorrentes (via `IncomeTemplate`, que gera instância todo mês no fechamento).
- **Despesas** (`expenses`): quatro tipos — `priority` (parcela de dívida, gerada automaticamente, valor não editável direto), `fixed` (despesa fixa recorrente, via `FixedExpenseTemplate`), `variable` (avulsa) e `card` (parcela de cartão, também não editável direto — só pela fatura de origem).
- **Dívidas** (`debts`): dívida parcelada com valor fixo por parcela (`installmentValue`); permite pagamento parcial/adiantado por parcela (`applyPaymentToInstallment`), reduzindo `remainingBalance` e recalculando parcelas futuras.
- **Cartões** (`cards` + `cardPurchases` + `cardInvoices`): limite, fatura por mês/ano, compra parcelada gera **todas** as parcelas futuras de uma vez (cada uma em seu mês, criando os meses futuros se preciso), fechamento de fatura, pagamento de fatura.

### 3.3 Fechamento mensal (`closing`)
Fecha o mês corrente e abre o seguinte numa única transação: gera as instâncias de receita/despesa recorrentes do próximo mês, gera a próxima parcela de cada dívida ativa, marca dívida como quitada quando não sobram parcelas, calcula saldo a transportar. Bem documentado e já coberto por teste.

### 3.4 Poupança e metas
- **Savings** (`savings`): reserva de emergência com depósitos/saques, sugestão de meses de cobertura.
- **Goals** (`goals`): metas de valor com prazo, progresso, contribuições.

### 3.5 Inteligência (o "cérebro" do app)
- **Saúde financeira** (`financialHealth`): score 0–100 combinando renda vs. despesa do mês, reserva de emergência, dívida vs. renda, categoria de maior peso.
- **Projeções** (`projections`): simula (sem gravar nada) receita recorrente + despesas fixas + parcelas de dívida + parcelas de cartão dos próximos N meses. **Motor central reaproveitado pelos dois simuladores** (ver §5 e §6).
- **Alertas** (`alerts`): fatura de cartão vencendo, comprometimento de renda alto, reserva abaixo do recomendado, dívida com parcela alta relativo à renda.
- **Recomendações** (`recommendations`): sugestões acionáveis (ex.: usar parte da reserva — além do mínimo de meses de cobertura — para quitar uma dívida; congelar categoria que estourou o orçamento).
- **Análise comportamental** (`behavioralAnalysis`): tendência de gasto por categoria ao longo do tempo, detecção de mês anômalo (gasto > média + 1,5 desvio-padrão).
- **Histórico** (`history`): série temporal de receita/despesa/saldo/score de saúde por vários meses.

### 3.6 Simuladores (o foco pedido — detalhado nos §5 e §6)
- **"E Se"** (`whatIfSimulator`): testa 6 tipos de cenário hipotético contra a projeção de 12 meses, sem gravar nada, com opção de salvar o resultado para consultar depois.
- **Simulador de Compras** (`purchaseSimulator`): antes de comprar algo, mostra se cabe no orçamento, sugere parcelamento e, se necessário, sugere esperar.

### 3.7 Frontend
17 páginas cobrindo cada módulo acima 1:1 (Dashboard, Receitas, Despesas, Dívidas, Cartões, Poupança, Metas, Orçamentos, Histórico, Tendências, Central de Alertas/Recomendações, Relatórios/impressão, os dois simuladores, Configurações, Login/Registro/recuperação de senha). Camada de API bem organizada em `lib/services/index.js` (um arquivo, um mapa claro de todos os endpoints) sobre um client axios único com refresh de token automático e deduplicado (`lib/api.js`).

**Avaliação geral:** cobertura funcional é ampla e coerente — não achei funcionalidade "solta" ou módulo órfão. A base (fechamento mensal, dívidas, cartões) é bem pensada e já estava bem comentada antes desta revisão.

---

## 4. Limpeza de manutenibilidade aplicada

Isso não muda nenhum comportamento (exceto onde indicado) — só reduz a quantidade de lugares que uma mudança futura precisa tocar.

### 4.1 `round2` centralizado
Existia um `utils/math.js` com `round2`/`clamp`/`percentChange` — só que **nenhum outro arquivo o importava**. Cada um dos 12 arquivos abaixo tinha sua própria cópia local, idêntica, de `round2`:

`goals.service.js`, `history.service.js`, `behavioralAnalysis.service.js`, `cardPurchases.service.js`, `financialHealth.service.js`, `debts.service.js`, `recommendations.service.js`, `dashboard.service.js`, `savings.service.js`, e os três dos simuladores/projeção (`projections.service.js`, `whatIfSimulator.service.js`, `purchaseSimulator.service.js`).

Em um app financeiro, arredondamento de valor monetário é exatamente o tipo de regra que um dia vai precisar mudar num lugar só (ex.: trocar para arredondamento bancário) — com 12 cópias, essa mudança exigiria lembrar de todas. Agora só `utils/math.js` define `round2`; todo o resto importa de lá.

### 4.2 Tratamento de erro do frontend centralizado
`lib/api.js` já tinha `extractErrorMessage(error, fallback)` — pronto, testado, mas usado só nas páginas de autenticação. Nas outras 11 páginas/componentes, a mesma lógica aparecia copiada inline, ~40 vezes:

```js
// padrão repetido em 40 lugares diferentes
catch (e) { toast.error(e?.response?.data?.error?.message ?? 'Erro ao salvar.'); }
```

Troquei todas as ocorrências por `extractErrorMessage(e, 'Erro ao salvar.')` (comportamento idêntico, uma função a menos para manter sincronizada) em: `QuickActions.jsx`, `DashboardPage`, `IncomesPage`, `SettingsPage`, `ExpensesPage`, `WhatIfSimulatorPage`, `GoalsPage`, `BudgetsPage`, `SavingsPage`, `PurchaseSimulatorPage`, `CardsPage`.

### 4.3 Utilitário de nomes de mês conectado
Existia um `backend/src/utils/monthNames.js` (`MONTH_NAMES`, indexado de 1 a 12) — **sem nenhum arquivo usando ele**. Ao mesmo tempo, `purchaseSimulator.service.js` tinha o mesmo array duplicado, hardcoded dentro de `buildExplanation`. Um provavelmente foi extraído numa sessão anterior com a intenção de virar o padrão do projeto, mas o ponto de uso nunca foi atualizado. Corrigido: `purchaseSimulator.service.js` agora importa de lá.

### 4.4 Comentários e nomes
Nos três arquivos do motor de simulação (`projections.service.js`, `whatIfSimulator.service.js`, `purchaseSimulator.service.js`), reescrevi os comentários para explicar o *porquê* de cada trecho não óbvio — em especial o motivo de cada correção do §5/§6, para que a próxima pessoa (ou eu, numa sessão futura) não precise re-descobrir o raciocínio do zero. Extraí `bestInstallmentPlan()` como uma função só, reaproveitada tanto por "melhor parcelamento agora" quanto por "aguardar até quando" no simulador de compras — antes eram duas buscas quase idênticas escritas em separado.

---

## 5. Análise profunda: Simulador "E Se"

### 5.1 O que ele faz
Recebe um mês de referência, um tipo de cenário e um input, e devolve a comparação mês a mês (12 meses) entre a projeção normal ("baseline") e a projeção com o cenário aplicado ("scenario") — sem gravar nada, a não ser que o usuário explicitamente salve. Seis tipos de cenário: quitar dívida, antecipar parcelas, guardar valor mensal, reduzir categoria, cancelar assinatura, aumentar receita.

A ideia de reaproveitar o mesmo motor de projeção (`projections.service.js`) usado pelo resto do app é boa — significa que o "E Se" não tem sua própria versão paralela e potencialmente divergente da matemática de dívida/cartão/renda recorrente. O problema não estava na arquitetura, estava em duas contas específicas.

### 5.2 Achado crítico: "quitar dívida" e "antecipar parcelas" eram um almoço grátis

**Antes**, o cenário `pay_debt` fazia isto:

```js
const debtSched = await getSingleDebtSchedule(debt, c.debtSchedule.length);
for (let i = 0; i < c.debtSchedule.length; i++) {
  c.debtSchedule[i] = round2(c.debtSchedule[i] - (debtSched[i] ?? 0));
}
// (fim — nada mais acontecia)
```

Ou seja: todas as parcelas futuras da dívida somem da projeção — e **nenhum custo é lançado em lugar nenhum**. O simulador reportava "ganho acumulado" de milhares de reais por quitar uma dívida, como se isso não custasse nada. Na prática, quitar uma dívida hoje custa exatamente o saldo devedor, hoje — só que esse pagamento nunca aparecia em nenhum mês da comparação.

Isso é o tipo de coisa que pode levar a uma decisão real ruim: um usuário vendo "quitar esta dívida gera R$X de ganho em 12 meses" sem NENHUMA menção ao fato de que, para conseguir isso, precisa desembolsar o saldo inteiro agora — por exemplo, esvaziando a reserva de emergência inteira achando que "não custa nada".

**Exemplo concreto** (os mesmos números usados no teste de regressão): dívida de R$1.200 em 12x de R$100, já com 3 parcelas geradas (jan/fev/mar), nada pago ainda, saldo devedor R$1.200. Rodando o simulador em março:

| | Antes da correção | Depois da correção |
|---|---|---|
| Custo no mês corrente (março) | R$100 (igual ao baseline — nenhum custo extra) | **R$1.200** (o saldo devedor inteiro) |
| "Ganho acumulado" em 12 meses | Positivo, artificialmente inflado (~R$1.100, todo ele fictício) | **≈ R$0** |

O "≈ R$0" no resultado corrigido não é uma coincidência nem um jeito de dizer "não faz diferença" — é a prova matemática de que o bug foi resolvido: este sistema **não modela juros**. Sem juros, pagar uma dívida antes ou pagá-la no cronograma normal, dentro do mesmo horizonte de tempo, tem exatamente o mesmo custo total — só muda *quando* o dinheiro sai do bolso, não *quanto*. Um "ganho" positivo aqui seria, por definição, dinheiro inventado. É exatamente essa invariante que o teste de regressão verifica (`totalGain ≈ 0` quando o horizonte projetado cobre todo o prazo restante da dívida).

O mesmo problema, com a mesma lógica, existia em `anticipate_installments` (antecipar um valor parcial no saldo devedor): o valor antecipado nunca era cobrado no mês corrente, só o benefício futuro (parcelas menores) aparecia.

**Correção aplicada:** os dois cenários agora lançam o custo à vista no mês 0 — `pay_debt` cobra o saldo devedor inteiro; `anticipate_installments` cobra o valor efetivamente aplicado (com um cuidado extra: se o valor pedido para antecipar for maior que o saldo devedor, o valor é limitado ao saldo devedor — igual já acontecia — e o cálculo do custo é derivado da diferença real entre os dois cronogramas já calculados, não de uma subtração solta, justamente para não cobrar a parcela do mês corrente em dobro quando a antecipação é grande o bastante para zerar a dívida inteira. Essa segunda casca de bug eu só descobri porque escrevi um teste para o caso extremo — valeu a pena testar com valores exagerados, não só o caso "normal").

### 5.3 Achado (na verdade, mais fundo): o motor de projeção desalinhava dívidas em 1 mês

Ao investigar o achado acima, percebi que `getSingleDebtSchedule` (dentro de `projections.service.js`, usado por **tudo** — dashboard, `/projections`, os dois simuladores) tinha um problema mais estrutural.

A função contava quantas parcelas já foram geradas (`expense.count`) e, a partir dali, "adivinhava" pela fórmula a parcela seguinte para preencher o índice 0 (o mês atual) da projeção. O problema: por como o fechamento mensal funciona, o mês atual **quase sempre já tem sua própria parcela real gerada** (ela nasce no fechamento do mês anterior, ou na criação da dívida). Então o índice 0 não mostrava a parcela real do mês atual — mostrava, "adivinhada", a parcela do mês **seguinte**. Isso empurrava o cronograma inteiro um mês para frente e, na ponta final, fazia a **última parcela** (normalmente a maior, pois absorve o resíduo do saldo) **desaparecer** do horizonte simulado.

Com os mesmos números do exemplo acima (dívida de R$1.200, 12x de R$100, 3 parcelas já geradas), a última parcela cai corretamente em dezembro e vale R$300 (resíduo). O comportamento antigo mostrava esse R$300 um mês adiantado (novembro) e dezembro aparecia com R$0 — como se a dívida já tivesse acabado um mês antes do que realmente termina.

**Por que isso importa para os simuladores especificamente:** o Simulador de Compras usa `projection[0].totalExpenses` como "quanto você já tem comprometido este mês" para decidir se uma compra cabe. Se esse número está sistematicamente errado (mostrando a parcela errada), a recomendação de compra herda o erro.

**Correção aplicada:** `getSingleDebtSchedule` agora busca as parcelas já geradas de verdade (por mês/ano) e usa o valor **real gravado** para qualquer mês que já tenha parcela — só passa a "projetar" pela fórmula a partir do primeiro mês que ainda não tem parcela nenhuma. Testei com dois cenários (nada pago ainda / parte já paga) verificando que a soma total do cronograma bate exatamente com o saldo devedor em ambos os casos.

### 5.4 Achado: dívida inválida falhava em silêncio
Se `debtId` não existisse ou fosse de outro usuário, o cenário simplesmente não fazia nada (`if (!debt) break;`) — o preview voltava com "nenhuma diferença", como se o cenário não ajudasse em nada, sem nenhuma pista de que, na verdade, a dívida não foi encontrada. Agora lança um erro 404 explícito (`DEBT_NOT_FOUND`), coerente com o padrão de erro usado no resto do backend.

### 5.5 Achado (não alterado — ver §7): "reduzir categoria" e "cancelar assinatura" são idênticos
Os dois cenários fazem exatamente a mesma conta (reduzir despesas fixas por um valor informado). `reduce_category` não recebe nem `categoryId` — não há, de fato, categoria nenhuma envolvida no cálculo, e nenhuma ligação com o histórico real de gastos daquela categoria (que o app já tem, em `categories.service.getBudgetStatus`). Deixei isso documentado no código (comentário no backend e na página) e como recomendação de melhoria (§7.2), em vez de mudar — trocar o formato do input mudaria o contrato da API e o formato já gravado em `Simulation.inputJson` de simulações salvas anteriormente.

### 5.6 Observação sobre "guardar valor mensal"
Esse cenário aumenta despesas fixas pelo valor guardado — o que está correto (o dinheiro reservado deixa de estar livre no fluxo de caixa mostrado), mas por natureza **sempre** vai mostrar "ganho acumulado" negativo, já que não há nenhum benefício futuro modelado (a poupança em si não rende, e o valor guardado não é somado de volta em lugar nenhum como um ativo). Isso não é um bug — é uma limitação de escopo que vale deixar clara: a ferramenta mostra "quanto isso custa da sua folga mensal", não "quanto você vai ter acumulado". Comentei isso no código; se fizer sentido para o produto, mudar a exibição para mostrar as duas métricas lado a lado (custo mensal + total acumulado na reserva) é uma melhoria de UX razoável para uma sessão futura.

### 5.7 Veredito
A arquitetura (reaproveitar o motor de projeção único, comparar baseline vs. cenário mês a mês) é sólida e é o jeito certo de construir isso. Mas, como estava, a ferramenta tinha um problema real de fundo: para os dois cenários de dívida — provavelmente os mais usados, e os que envolvem a decisão financeira de maior impacto (usar reserva para quitar dívida) — o número mostrado ao usuário era matematicamente incorreto, sempre a favor de "faça isso, é de graça". Com a correção, os cenários de dívida agora refletem corretamente que não existe almoço grátis sem juros envolvidos; os cenários de renda/despesa (guardar, reduzir, aumentar) já estavam matematicamente corretos antes.

---

## 6. Análise profunda: Simulador de Compras

### 6.1 O que ele faz
Recebe uma compra hipotética (descrição, valor, parcelas, cartão opcional) e devolve: se é recomendada, o comprometimento de renda resultante, se o cartão tem limite suficiente, o melhor parcelamento possível e, se nada funcionar, sugestão de quando esperar.

### 6.2 Achado: sugestões ignoravam o limite do cartão
O limite de um cartão é consumido pelo **valor total** da compra assim que ela é parcelada (todas as parcelas futuras reservam limite de uma vez — é assim que `computeUsedLimit` já funciona em `cards.service.js`), não pela parcela mensal isolada. Ou seja: se o limite disponível não cobre o valor total, **nenhuma quantidade de parcelas resolve isso** — parcelar mais não libera limite.

Antes, `bestInstallments` (melhor parcelamento) e `waitUntil` (aguardar até quando) eram calculados olhando só para o comprometimento de renda, **sem checar o limite nenhuma vez**. Resultado possível: o sistema sugeria "💡 Melhor parcelamento: 6x de R$333" para uma compra que o cartão nem comporta no valor total — uma sugestão que parece um caminho válido, mas não é.

**Correção:** quando o limite do cartão já é insuficiente para o valor total, `bestInstallments` e `waitUntil` agora voltam `null` em vez de sugerir algo que não resolve o problema real. A explicação já liderava com "limite insuficiente" nesse caso — agora a caixa de "sugestões do sistema" no frontend também para de mostrar uma sugestão contraditória.

### 6.3 Achado: "aguardar até" só testava pagar à vista
A busca por "em que mês futuro esta compra cabe" testava exclusivamente a hipótese de pagar o valor **total, de uma vez**, naquele mês futuro — nunca testava "parcelado, caberia?". Para qualquer compra de valor alto relativo à renda (justamente o caso em que "aguardar" é uma sugestão mais útil), pagar à vista pode ser matematicamente impossível em qualquer mês (o valor sozinho, dividido pela renda, já estoura a faixa saudável, não importa o quão baixo esteja o resto do comprometimento) — então a busca raramente encontrava resposta, mesmo quando parcelar em um mês futuro seria perfeitamente viável.

**Exemplo** (do teste de regressão): renda média R$1.000, compra de R$2.400. Pagar à vista dá 2,4× a renda — sempre "crítico", em qualquer mês, não importa o comprometimento. A versão antiga nunca encontrava uma resposta aqui. Com compromissos caindo para R$150/mês num mês futuro (ex.: uma dívida quitada), parcelar em 10x (R$240/parcela) já cai em faixa saudável — a versão corrigida encontra esse mês e já sugere o parcelamento junto.

**Correção:** extraí a busca "existe algum parcelamento (1× a 12×) saudável?" numa função só (`bestInstallmentPlan`), reaproveitada tanto para "agora" quanto para cada mês futuro candidato — então "aguardar até" agora responde a pergunta que a ferramenta realmente promete responder, e já vem com a sugestão de parcelamento para aquele mês futuro (antes só dizia o mês, sem dizer como comprar). Atualizei a página para mostrar isso.

### 6.4 Achado (não alterado — ver §7): três definições diferentes de "comprometimento de renda" no app
Ao investigar o denominador/numerador desta conta, achei que o app tem **três fórmulas diferentes** para "quanto da minha renda está comprometido", uma em cada tela:

| Onde | Numerador | Denominador |
|---|---|---|
| Dashboard (`dashboard.service.js`) | Todas as despesas planejadas do mês (fixas + variáveis + prioritárias + cartão — dado real) | Média de renda dos últimos 3 meses |
| Saúde financeira (`financialHealth.service.js`) | Mesmo numerador (despesas planejadas reais do mês) | Renda real **só deste mês** (não é média) |
| Simulador de Compras (`purchaseSimulator.service.js`) | Só despesas fixas + dívida + cartão *projetadas* (nunca inclui gasto variável, já que este não tem como ser projetado) | Média de renda dos últimos 3 meses (igual ao Dashboard) |

Nenhuma das três está "errada" isoladamente — mas um usuário que olha o badge de comprometimento no Dashboard e depois roda o Simulador de Compras no mesmo mês pode ver dois percentuais diferentes sem entender por quê, porque literalmente são contas diferentes. Não mudei nada aqui porque unificar isso é uma decisão de produto (qual das três é a "oficial"?) que vale mais a pena decidir explicitamente do que eu escolher sozinho — deixo como recomendação prioritária no §7.1.

### 6.5 Veredito
A ideia central (comprometimento de renda projetado, faixas saudável/atenção/risco/crítico, sugestão de parcelamento e de espera) é útil e bem-vinda — é o tipo de fricção saudável que ajuda a não fazer uma compra por impulso. As duas correções acima destravam exatamente os casos em que a ferramenta mais precisa funcionar bem: compra cara no cartão (onde o limite manda mais que a renda) e compra cara parcelável (onde "aguardar" só faz sentido se também considerar parcelar). A inconsistência de fórmula do §6.4 é o maior ponto de atenção que sobra — vale uma decisão de produto, não uma correção de bug.

---

## 7. Recomendações para o futuro (não implementadas agora — por quê)

Prioridade decrescente. Nenhuma delas é um bug no sentido de "dá resultado errado" — são decisões de produto ou melhorias que preferi documentar em vez de implementar sem confirmar com você, para não mudar contrato de API/dado salvo por conta própria.

1. **Unificar a fórmula de comprometimento de renda** (§6.4). Sugestão concreta: escolher uma fonte única (ex.: sempre despesas reais do mês ÷ média de 3 meses) e fazer as três telas consumirem a mesma função de `_shared/`. Hoje `_shared/commitment.js` só tem as faixas (`classifyCommitment`), não o cálculo do próprio índice — seria o lugar natural para centralizar isso.
2. **"Reduzir categoria" com categoria de verdade** (§5.5). Adicionar `categoryId` opcional ao input, usar `categories.service.getBudgetStatus` (já existe) para pré-preencher com o gasto médio real da categoria em vez de pedir um valor "no chute".
3. **`fixedExpenses` do mês atual usando dado real, não só template ativo.** Corrigi exatamente esse tipo de discrepância para dívidas (§5.3) — o mesmo raciocínio vale, em menor escala, para despesas fixas recorrentes: se um template for editado depois que a instância do mês já foi gerada, a projeção do mês atual usa o valor **novo** do template, não o valor **real** já lançado naquele mês. Efeito bem mais raro (exige editar o template no meio do mês), por isso deixei fora do escopo desta rodada, mas o padrão de correção já está pronto (mesma ideia de "usar valor real quando existir, projetar só quando não existir" aplicada em `getSingleDebtSchedule`).
4. **ESLint básico** (`no-unused-vars` pelo menos). Teria pego de graça, por exemplo, o import de `AppError` que sobrava sem uso em `purchaseSimulator.service.js` (limpei ao reescrever o arquivo).
5. **Cenários combináveis no "E Se"** (ex.: "e se eu quitasse esta dívida E aumentasse minha receita" ao mesmo tempo). Hoje é um de cada vez — razoável para uma v1, mas é a limitação mais visível se o uso pedir mais.
6. **`ExpensesPage.jsx` está com 647 linhas** — o maior arquivo do frontend, de longe. Funciona bem, mas concentra formulário + tabela + filtros + paginação num arquivo só; separar em subcomponentes ajudaria a manutenção futura (não é urgente, é observação de organização).

---

## 8. Arquivos alterados

**Backend — lógica:**
- `src/modules/projections/projections.service.js` — correção do alinhamento de mês no cronograma de dívida (§5.3); `round2` centralizado.
- `src/modules/simulators/whatIfSimulator.service.js` — custo à vista em `pay_debt`/`anticipate_installments` (§5.2); erro explícito para dívida inválida (§5.4); `round2` centralizado.
- `src/modules/simulators/purchaseSimulator.service.js` — limite do cartão bloqueando sugestões (§6.2); "aguardar até" considerando parcelamento (§6.3); conectado a `utils/monthNames.js`.
- `src/modules/{goals,history,behavioralAnalysis,financialHealth,debts,recommendations,dashboard,savings}/*.service.js` e `src/modules/cards/cardPurchases.service.js` — só a centralização do `round2` (sem mudança de comportamento).

**Backend — testes (novos/ampliados):**
- `tests/services/projections.service.test.js` — **novo**, 5 testes.
- `tests/services/purchaseSimulator.service.test.js` — **novo**, 7 testes.
- `tests/services/whatIfSimulator.service.test.js` — ampliado de 3 para 10 testes.
- `tests/helpers/prismaMock.js` — adicionado `aggregate` em `incomeTemplate`/`fixedExpenseTemplate` (faltava para poder testar o motor de projeção, que nunca tinha teste próprio antes).

**Frontend:**
- `src/pages/WhatIfSimulatorPage.jsx` — lista de simulações salvas agora mostra a mesma métrica ("ganho acumulado") que a prévia ao vivo (§5, inconsistência de rótulo corrigida); comentário sobre `reduce_category`/`cancel_subscription`; `extractErrorMessage`.
- `src/pages/PurchaseSimulatorPage.jsx` — mostra o parcelamento sugerido dentro de "aguardar até" (§6.3); `extractErrorMessage`.
- `src/pages/{DashboardPage,IncomesPage,SettingsPage,ExpensesPage,GoalsPage,BudgetsPage,SavingsPage,CardsPage}.jsx`, `src/components/dashboard/QuickActions.jsx` — só `extractErrorMessage` (sem mudança de comportamento).

---

## 10. Segunda rodada: notificações, busca, foco ao digitar e fechamento de mês

Depois da entrega inicial, você relatou mais quatro problemas de uso real. Aqui está o que cada um era e o que mudou.

### 10.1 Bug de perda de foco ao digitar
**Causa raiz (a mesma nas 4 ocorrências):** um componente React definido **dentro** de outro componente (`function InputFields() {...}` dentro de `WhatIfSimulatorPage`, por exemplo), usado como `<InputFields />`. O React identifica um componente pela referência da função, não pelo nome — como a função pai recria essa função a cada render, e digitar em QUALQUER campo dispara um render (via `setState`), o React interpretava isso como "um componente diferente" a cada tecla e desmontava/remontava o campo, jogando o foco fora dele.

Encontrei 4 ocorrências (busquei por esse padrão em todo o frontend); só a primeira tinha campo de texto — as outras têm o mesmo problema de fundo, com sintoma mais brando (o elemento inteiro remonta à toa a cada render, mas sem input para perder foco):

| Arquivo | Componente | Sintoma visível |
|---|---|---|
| `WhatIfSimulatorPage.jsx` | `InputFields` | **Perda de foco ao digitar** (o problema que você viu) |
| `GoalsPage.jsx` | `GoalCard` | Card de meta remontava à toa a cada ação na página |
| `ExpensesPage.jsx` | `AddButton` | Botão remontava à toa (sem sintoma visível, mas mesmo problema) |
| `SavingsPage.jsx` | `CustomTooltip` | Tooltip do gráfico remontava à toa |

**Correção:** os 4 foram movidos para fora do componente pai (nível do módulo), recebendo o que precisam via props em vez de fechar sobre o estado do componente pai — é assim que `CustomTooltip` já estava feito corretamente em `WhatIfSimulatorPage.jsx`, usei o mesmo padrão nos outros três.

### 10.2 Sino de notificações
Era 100% decorativo — o botão não tinha `onClick`, e o ponto vermelho era fixo no HTML (sempre aparecia, independente de existir alerta ou não). Ao investigar, também achei que a regra de alerta "conta perto de vencer" **não existia** — só havia alerta para conta **já atrasada**.

**O que mudou:**
- **Backend:** nova regra em `alerts.service.js` — conta com vencimento nos próximos 7 dias gera alerta (crítico se for em até 2 dias, atenção caso contrário), citando a conta pelo nome. Tem teste cobrindo os casos (nenhuma conta, uma, várias, e a distinção com "já atrasada").
- **Frontend:** o sino agora busca os alertas de verdade (reaproveita o mesmo endpoint que a Central de Alertas usa), mostra o ponto vermelho só quando há alerta ativo, e abre um dropdown ao clicar com a lista de alertas + link para a Central de Alertas. Atualiza ao trocar de mês e a cada 60s (alertas de prazo mudam só com o tempo passando, sem o usuário fazer nada).

### 10.3 Barra de busca
Também era decorativa (comentário no próprio código dizia "visual apenas"). Implementei uma busca de verdade:
- **Backend:** endpoint novo (`GET /search?q=`), módulo `search` — procura por texto (case-insensitive) em despesas, receitas, dívidas, cartões e metas, sempre restrito ao usuário logado, até 5 resultados por tipo. Testado.
- **Frontend:** a barra do Topbar busca com debounce de 300ms enquanto você digita, mostra um dropdown com os resultados agrupados por tipo (ícone + nome + valor/mês), e clicar num resultado já leva para a página certa — inclusive selecionando o mês certo, se o resultado for de um mês diferente do que está aberto agora. Para despesas/dívidas, já abre na aba certa (fixa/variável/dívidas) — adicionei suporte a `?tab=` na URL de Despesas para isso funcionar.

### 10.4 Fechar o mês não ia para o próximo automaticamente
O código já tinha uma tentativa de correção anterior para isso (um comentário no arquivo já descrevia esse exato sintoma) — mas a implementação tinha uma falha sutil: depois de fechar o mês, chamava `initialize()` (que busca "o mês de hoje" pela **data real do calendário**, sempre, mesmo que você tenha acabado de fechar um mês diferente) e só DEPOIS corrigia manualmente para o mês certo. Funcionava na maioria das vezes, mas deixava uma janela onde o estado global apontava para o mês errado — e ainda chamava, por engano, uma atualização do dashboard vinculada ao mês ANTIGO (o que acabou de fechar), que podia sobrescrever a tela com o mês errado se essa resposta demorasse mais que a do mês novo.

**Correção:** criei `refreshMonths()` — atualiza só a lista de meses (agora com o mês novo) sem tocar no mês selecionado — e o fechamento passou a selecionar o mês novo diretamente, sem passar por um valor errado no meio do caminho. Também protegi o carregamento de dados do Dashboard contra respostas que chegam fora de ordem (se a busca do mês antigo demorar mais que a do mês novo, ela agora é ignorada em vez de sobrescrever a tela).

### 10.5 Testes e validação desta rodada
- **Backend:** 2 arquivos de teste novos (`alerts.service.test.js` — 5 testes, `search.service.test.js` — 6 testes). Suíte total: **116 testes em 18 arquivos**, todos passando.
- **Frontend:** ainda não tem suíte de testes automatizados (isso já valia antes desta rodada — é uma lacuna conhecida, não algo que apareceu agora). Validei manualmente lendo o código e rodando `npm run build` depois de cada mudança para garantir que tudo compila sem erro.

### 10.6 Arquivos alterados nesta rodada
**Backend:** `modules/alerts/alerts.service.js` (nova regra), `modules/search/` (módulo novo: `search.service.js`, `search.routes.js`), `routes/index.js` (registro da rota), `tests/helpers/prismaMock.js` (mocks novos: `alert`, `income.findMany`), `tests/services/alerts.service.test.js` (novo), `tests/services/search.service.test.js` (novo).

**Frontend:** `store/monthStore.js` (`refreshMonths`), `components/dashboard/QuickActions.jsx` (fechamento de mês), `pages/DashboardPage.jsx` (proteção contra resposta fora de ordem), `components/layout/Topbar.jsx` (busca + notificações, reescrito), `lib/services/index.js` (`searchApi`), `pages/WhatIfSimulatorPage.jsx`, `pages/GoalsPage.jsx`, `pages/ExpensesPage.jsx` (+ suporte a `?tab=`), `pages/SavingsPage.jsx` (os 4 ajustes de componente aninhado).

---

## 11. Como validar

```bash
# Backend
cd backend
npm install
npx jest              # 116 testes, 18 suítes

# Frontend
cd frontend
npm install
npm run build          # build de produção limpo
```

Os testes em `whatIfSimulator.service.test.js`, `purchaseSimulator.service.test.js`, `projections.service.test.js`, `alerts.service.test.js` e `search.service.test.js` têm comentário explicando o cenário numérico e por que o resultado esperado é aquele — servem também como documentação viva de como cada conta deveria se comportar.

O frontend ainda não tem suíte de testes automatizados — validação nesta rodada foi manual (leitura de código) + `npm run build` limpo após cada mudança. Se quiser, posso montar uma suíte básica (Vitest + Testing Library) numa próxima sessão — é a lacuna mais importante que resta no projeto como um todo.


---

## 12. Terceira rodada: itens do documento de melhorias (saldo, dívidas, cartão, assinaturas, reserva, validação, tutorial)

Implementação dos 7 itens pedidos no documento de melhorias, na ordem: bloqueio de saldo negativo, correção do ajuste de parcela de dívida, despesa fixa com forma de pagamento, tipo de compra (parcelamento/assinatura), validação (CPF), reforma da reserva financeira, e tutorial interativo.

### 12.1 Bloqueio de pagamento sem saldo (item 3)
Não existia (e ainda não existe, como conceito de produto) um "saldo de conta corrente" — o app sempre foi um rastreador de receita/despesa por mês. Criei `_shared/balance.js`: **saldo disponível = toda a renda já recebida − todas as despesas já pagas − o que saiu do saldo para a reserva** (sempre recalculado na hora, nunca um número guardado que possa dessincronizar). Apliquei essa checagem antes de: pagar despesa fixa/variável, criar despesa já como paga, pagar parcela de dívida, pagar fatura de cartão. Qualquer uma dessas operações agora é rejeitada com mensagem clara se faltar saldo — nunca mais fica negativo.

### 12.2 Correção do ajuste de parcela (item 4)
Confirmado na auditoria original: existia um campo `pendingCarryOver` no banco pronto para isso, nunca usado. Agora pagar mais reduz a próxima parcela pelo excedente exato; pagar menos aumenta pelo tanto que faltou. Uma parcela já paga (mesmo parcialmente) não aceita novo pagamento — o ajuste já foi propagado. Também corrigi o mesmo mecanismo dentro do motor de projeções, para simulações continuarem precisas.

### 12.3 Despesa fixa com forma de pagamento (item 1)
Campo de forma de pagamento (Conta/PIX/Dinheiro/Débito/Cartão) em despesas fixas, com seletor de cartão condicional. Vinculada a cartão, a despesa nasce direto na fatura (mesmo mecanismo de compra parcelada) — nunca desconta o saldo até a fatura ser paga.

### 12.4 Tipo de compra: eventual, parcelamento, assinatura (item 2)
- **Eventual**: já existia (despesa variável) — mantido como está.
- **Parcelamento**: reaproveitei os dois sistemas já existentes e testados (dívida/prioridade para parcelamento fora do cartão, compra no cartão para parcelamento no cartão) em vez de criar um terceiro sistema paralelo. Adicionei "já está em andamento? (parcela atual)" nos dois formulários — permite registrar uma compra que começou antes de usar o app, descontando o que já foi pago sem recriar esse histórico.
- **Assinatura**: sistema novo (`Subscription`), com periodicidade mensal/anual/customizada, data de encerramento opcional, pausar/retomar/cancelar. Entra no fechamento mensal: cobra automaticamente quando a data chega (a maioria dos meses não gera nada para assinaturas anuais — só quando a data realmente vence). Nova página `/subscriptions`.

### 12.5 Validação (item 5)
O backend já usa Zod extensivamente e de forma consistente em todo o app (confirmei revisando os validadores existentes) — não havia lacuna real aí. Não existe (nem nunca existiu) campo de CPF no sistema; criei o utilitário de validação (dígitos verificadores, backend `utils/cpf.js` + frontend `lib/validation.js`) pronto para uso assim que um formulário precisar dele.

### 12.6 Reforma da reserva financeira (item 6)
Achado importante: todo depósito sempre descontava do saldo do mês, mesmo dinheiro "que já estava guardado fora do app" — não existia distinção. Adicionei `origin` (`balance`/`external`) ao depósito: só `balance` desconta o saldo disponível (item 3) e o saldo do mês no dashboard. A página de Reserva agora pergunta a origem e mostra os três números pedidos: total reservado, quanto saiu do saldo, quanto foi só informado como já guardado.

### 12.7 Tutorial interativo (item 7)
Escolhi **Driver.js** (MIT, ~5kb, sem dependências pesadas) entre as três opções sugeridas — Intro.js tem modelo de licença dual (parte comercial) que evitei por precaução; Shepherd.js depende do Popper.js e é mais pesado. Como o tour passa por várias páginas e o Driver.js só entende elementos que já estão na tela, escrevi `TutorialRunner.jsx` para navegar (React Router) para a rota certa antes de cada passo avançar. Cobre: Dashboard (resumo, saúde financeira, ações rápidas/fechamento de mês), Receitas, Despesas (as 3 abas), Assinaturas, Cartões, Reserva, Metas, Relatórios e Configurações. Dispara sozinho no primeiro acesso (guardado por usuário no navegador) e tem botão "Ver tutorial novamente" em Configurações.

### 12.8 Testes e validação desta rodada
Backend: **180 testes em 22 arquivos**, todos passando (eram 116 no início desta rodada — 5 arquivos de teste novos: `balance`, `subscriptions`, `cpf`, além de ampliar `debts`, `expenses`, `savings`, `cardPurchases`, `cardInvoices`, `cards`). Frontend builda limpo. Três migrations novas do Prisma (`fixed_expense_payment_method`, `subscriptions`, `savings_origin`) — **não consegui rodar `prisma validate`/`migrate` neste sandbox** (sem acesso de rede ao binário do Prisma); revisei a sintaxe manualmente com cuidado, mas rode `npx prisma migrate dev` no seu ambiente antes de subir para produção.

### 12.9 Arquivos novos/alterados nesta rodada
**Backend (novo):** `modules/subscriptions/` (módulo completo), `modules/_shared/balance.js`, `utils/cpf.js`, 3 migrations, 5 arquivos de teste novos.
**Backend (alterado):** `expenses.service.js`/`.validators.js`/`.routes.js`, `debts.service.js`/`.validators.js`, `cardPurchases.service.js`/`cards.validators.js`, `cardInvoices.service.js`, `cards.service.js`, `savings.service.js`/`.validators.js`/`.routes.js`, `closing.service.js`, `projections.service.js`, `schema.prisma`, `routes/index.js`.
**Frontend (novo):** `pages/SubscriptionsPage.jsx`, `lib/tutorialSteps.js`, `lib/validation.js`, `store/tutorialStore.js`, `components/tutorial/TutorialRunner.jsx`.
**Frontend (alterado):** `pages/ExpensesPage.jsx`, `pages/CardsPage.jsx`, `pages/SavingsPage.jsx`, `pages/SettingsPage.jsx`, `pages/DashboardPage.jsx`, `components/layout/{AppLayout,Topbar,Sidebar}.jsx`, `components/ui/index.jsx` (Card agora repassa props extras), `lib/services/index.js`, `App.jsx`, `package.json` (driver.js).
