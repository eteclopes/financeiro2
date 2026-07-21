# FinançasPro — Auditoria complementar (Claude)

Esta auditoria não repete o que já está em `AUDITORIA-FINAL.md` — parte dele
(rotação de refresh token, bcrypt 12 rounds, isolamento por `userId`, Helmet/CORS)
foi checado de novo, de forma independente, item por item, e se confirma.
O que segue são achados **novos**, encontrados lendo o código real (não um
checklist genérico) e testados sempre que possível (env.js foi executado de
verdade com/sem `DIRECT_URL`; `npm audit`/`npm outdated` rodaram nos dois
`package.json`; toda rota e todo service que recebe `:id` foi lido para
confirmar isolamento por usuário).

**Sobre o escopo:** o pedido original cobre 15 frentes (arquitetura,
segurança, backend, banco, frontend, API, performance, auth, env, deploy,
qualidade, bugs, testes, UX, resultado). Isso é auditoria de verdade — o tipo
de trabalho que uma consultoria cobraria várias diárias para fazer com rigor.
Nesta rodada priorizei **segurança, integridade financeira e deploy**, por
ser o que mais importa num app que mexe com dinheiro de verdade, com a mesma
profundidade que uma auditoria paga teria nessas frentes. Frontend
(acessibilidade/dark mode/responsividade), suíte de testes automatizados e
uma segunda passada de performance em cada módulo ficaram de fora desta
rodada — ver seção final.

---

## CRÍTICO

### C1 — Credencial real do banco exposta no .zip enviado para auditoria
**Causa:** `backend/.env` (com a connection string real do Supabase, senha
incluída) estava dentro do `.zip` do projeto. `.gitignore` já lista `.env`
corretamente — o problema não é o Git, é que zipar a pasta inteira do
projeto para compartilhar/auditar inclui arquivos que o Git ignora.
**Impacto:** a senha do seu Postgres agora existe em pelo menos mais um
lugar fora do seu controle direto (esta conversa). Mesmo sem evidência de
vazamento maior, o tratamento correto de credencial exposta é assumir
comprometida.
**Ação necessária (não automatizável por mim):**
1. Supabase → Project Settings → Database → **Reset database password**.
2. Nunca zipar/enviar a pasta do projeto sem excluir `.env` antes
   (`zip -x '*.env'` ou remover manualmente).
3. Ao gerar a senha nova, copie **as duas** connection strings (pooler e
   direct) — você vai precisar de ambas, ver C2.
**Arquivo:** `backend/.env` (só adicionei um aviso + o placeholder de C2 —
não fabriquei uma senha nova, isso só você faz no painel do Supabase).

### C2 — `DIRECT_URL` exigida pelo schema mas nunca definida (quebra build de produção)
**Causa raiz:** `schema.prisma` declara `directUrl = env("DIRECT_URL")`
(necessário porque o pooler do Supabase não suporta as operações que o
Prisma Migrate precisa fazer), mas `DIRECT_URL` não existe em `.env`,
`.env.example`, `env.js` nem em `render.yaml`. Testei isso na prática:
subindo o `env.js` com as demais variáveis presentes e `DIRECT_URL` ausente,
o processo falha imediatamente. `prisma generate`/`migrate deploy` fazem a
mesma checagem antes de tentar conectar em qualquer banco.
**Impacto real:** o `build` do `render.yaml`/`railway.toml` roda
`prisma generate && prisma migrate deploy` — ambos falham sem essa variável.
Ou seja: com a configuração atual, um deploy do zero neste projeto **não
sobe**. Isso também quebra o passo `npm run prisma:generate` do setup local
descrito no `README.md`.
**Correção:** `DIRECT_URL` agora é validada em `env.js` (falha rápido com
mensagem clara em vez do erro genérico do Prisma CLI) e documentada em
`.env.example`. Faltou adicionar em `render.yaml`/no painel do Railway — nenhum
dos dois eu alterei automaticamente porque não tenho o valor real; adicione
lá a mesma "Direct connection" que pegar no Supabase junto da senha nova (C1).
**Arquivos:** `backend/src/config/env.js`, `backend/.env.example`,
`backend/.env` (placeholder).

---

## ALTO

### A1 — Enumeração de usuários por timing attack no login
**Causa raiz:** `login()` retornava imediatamente quando `!user`, mas rodava
`bcrypt.compare` (propositalmente lento, ~100ms+ com 12 rounds) quando o
usuário existia. A mensagem de erro já era genérica ("e-mail ou senha
inválidos"), mas o **tempo de resposta diferente** ainda permite a um
atacante descobrir quais e-mails têm conta, testando um por um e medindo a
latência.
**Correção:** `bcrypt.compare` agora roda sempre — contra um hash "morto"
quando o e-mail não existe — igualando o tempo de resposta nos dois casos.
**Arquivo:** `backend/src/modules/auth/auth.service.js`

### A2 — Condição de corrida no depósito/saque do saldo guardado
**Causa raiz:** `deposit`/`withdraw` liam o saldo atual (`getCurrentBalance`)
e só depois gravavam um novo registro com `balanceAfter` calculado em cima
daquela leitura — sem lock nem transação. Duas chamadas concorrentes (duplo
clique, retry de rede, duas abas) podem ler o **mesmo** saldo e gravar dois
`balanceAfter` incorretos (lost update clássico). É a mesma classe de bug
que `closing.service.js` já trata com `SELECT ... FOR UPDATE` — só não tinha
sido aplicada aqui.
**Correção:** as duas funções agora rodam dentro de `prisma.$transaction`,
com `pg_advisory_xact_lock(userId)` no início — serializa apenas
depósitos/saques do mesmo usuário entre si (nenhuma outra linha/tabela é
travada) e libera sozinho ao fim da transação.
**Arquivo:** `backend/src/modules/savings/savings.service.js`

### A3 — Mesma condição de corrida no limite do cartão (TOCTOU)
**Causa raiz:** em `createCardPurchase`, o limite disponível era calculado
**fora** da transação principal. Duas compras simultâneas no mesmo cartão
podiam ler o mesmo `usedLimit`, as duas passarem na checagem de limite, e
juntas ultrapassarem o limite do cartão.
**Correção:** a checagem de limite foi movida para dentro da transação,
atrás de um `pg_advisory_xact_lock(cardId)` — mesma técnica de A2, agora
travando por cartão em vez de por usuário.
**Arquivo:** `backend/src/modules/cards/cardPurchases.service.js`

### A4 — `database.sql` é MySQL; o projeto real roda em PostgreSQL/Supabase
**Causa:** o arquivo usa sintaxe MySQL (`BIGINT UNSIGNED`, `ENGINE=InnoDB`,
`ON UPDATE CURRENT_TIMESTAMP`) e o `README.md` o apresenta como alternativa
válida ao Prisma Migrate para o setup local. Mas `schema.prisma` está
configurado com `provider = "postgresql"` e o `.env` real conecta no
Supabase (Postgres) — `database.sql` não roda nesse banco (dialeto errado).
Parece um artefato de uma fase anterior do projeto (README menciona
"XAMPP"/MySQL) que ficou para trás quando a stack migrou para Supabase.
**Impacto:** qualquer pessoa nova no projeto que siga o README e tente essa
alternativa perde tempo com um arquivo que não é compatível com o banco real.
**Não corrigi automaticamente** — decisão sua: (a) apagar `database.sql` e
o trecho do README sobre XAMPP/MySQL, deixando só Prisma Migrate como fonte
única da verdade (recomendo isso), ou (b) regerar como DDL Postgres válido
se quiser manter as duas opções.

---

## MÉDIO

### M1 — N+1 query em `listCards`
1 query para listar cartões + 1 query de agregação **por cartão** — o
dashboard chama isso a cada carregamento. Reescrito para 2 queries fixas,
não importa quantos cartões o usuário tenha.
**Arquivo:** `backend/src/modules/cards/cards.service.js`

### M2 — Índices ausentes em `Card.userId` e `Goal.userId`
Todos os outros modelos com listagem por usuário (`Income`, `Debt`,
`Expense`, `SavingsTransaction`, `Simulation`) têm `@@index([userId])`;
`Card` e `Goal` não tinham. Inofensivo com poucos usuários, vira table scan
conforme a base cresce.
**Corrigido no schema** — falta gerar a migration (não consigo rodar
`prisma migrate` neste ambiente, sem acesso de rede ao binário do Prisma):
```
npx prisma migrate dev --name add_missing_card_goal_indexes
```
**Arquivo:** `backend/prisma/schema.prisma`

### M3 — `deleteSimulation` derrubava 500 em vez de 404
Lançava `new Error(...)` genérico em vez de `AppError` — como não é
`instanceof AppError`, o `errorHandler` tratava "simulação não existe/não é
sua" (caso esperado) como falha inesperada: HTTP 500 e log como erro real,
poluindo os logs de produção. Corrigido para `AppError(..., 404, ...)`, e
aproveitei para remover o import não utilizado de `debtsService` no mesmo
arquivo.
**Arquivo:** `backend/src/modules/simulators/whatIfSimulator.service.js`

### M4 — `JWT_ACCESS_SECRET` aceitava só 16 caracteres
Fraco para HS256 (recomendado: 32+ bytes de entropia, ex.
`openssl rand -hex 32`). Mínimo elevado para 32; o placeholder de dev já
tinha 49 caracteres, então isso não quebra o `.env` atual.
**Arquivo:** `backend/src/config/env.js`

### M5 — `railway.toml` **e** `render.yaml` coexistindo
Comentário em `auth.controller.js` ("produção... backend (Render)") sugere
que Render é o provedor real; `railway.toml` parece órfão de uma migração
de provedor. Não apaguei nenhum dos dois sem confirmar — qual está
realmente em uso?

### M6 — Modelo `AuditLog` nunca é usado
Existe uma tabela inteira (`entity`, `entityId`, `action`,
`oldValueJson`/`newValueJson`) no schema, mas nenhum `prisma.auditLog.*`
aparece em lugar nenhum do código (confirmei com grep no projeto todo). Ou é
uma feature planejada e não implementada, ou é código morto — vale decidir
qual antes de eu mexer, já que não é código gerado por engano, parece
intencional.

### M7 — Nenhum endpoint de listagem tem paginação
`GET /expenses`, `/incomes`, `/debts`, `/savings`, `/simulators/what-if`
retornam **todos** os registros do usuário de uma vez. Inofensivo hoje (uso
pessoal), mas cresce sem limite com anos de histórico. Vale `?page=`/`?limit=`
ou cursor-based quando o volume justificar.

### M8 — Dependências desatualizadas (sem CVE conhecida, mas várias major
versions atrás) — dados reais de `npm outdated`, não estimativa:

| Pacote | Atual | Última | Onde |
|---|---|---|---|
| `@prisma/client` / `prisma` | 5.22 | 7.8 | backend |
| `express` | 4.22 | 5.2 | backend |
| `zod` | 3.25 | 4.4 | backend |
| `helmet` | 7.2 | 8.2 | backend |
| `express-rate-limit` | 7.5 | 8.5 | backend |
| `react` / `react-dom` | 18.3 | 19.2 | frontend |
| `vite` | 5.4 | 8.1 | frontend |
| `react-router-dom` | 6.30 | 7.18 | frontend |
| `tailwindcss` | 3.4 | 4.3 | frontend |
| `recharts` | 2.15 | 3.9 (2.x descontinuado pelo próprio pacote) | frontend |

`npm audit`: 0 vulnerabilidades no backend. No frontend, 2 (1 moderada, 1
alta), ambas da mesma causa — `esbuild`/`vite` — e afetam **só o servidor de
dev** (`npm run dev`), não o build de produção que o Vercel serve. Não
apliquei nenhum upgrade de major version automaticamente (Express 5, Zod 4 e
Vite 8 têm breaking changes reais que merecem uma rodada de testes dedicada,
não um bump silencioso numa auditoria).

---

## BAIXO

- **Defesa em profundidade:** vários `update`/`delete` finais usam só
  `where: { id }` (sem repetir `userId`) — seguro hoje porque sempre vêm
  depois de um `getOwnedXOrThrow`, mas repetir o `userId` na escrita também
  blindaria contra um refactor futuro que remova essa checagem sem querer.
- `POST /auth/refresh` e `/auth/logout` não passam por `authLimiter` — risco
  baixo (token opaco de 384 bits), mas simples de adicionar.
- `/auth/register` ainda revela e-mail já cadastrado (`EMAIL_IN_USE`) — é um
  trade-off UX vs. enumeração consciente, comum na indústria; mantive como
  está, mas registrando que é uma escolha, não um esquecimento.
- `syncOverdueStatuses` faz um `UPDATE` a cada `GET /expenses` — os próprios
  comentários no código já sinalizam isso como algo a mover para um cron job
  quando a base crescer.
- `onDelete` das FKs financeiras depende do default implícito do Prisma
  (documentado como "Restrict" no `AUDITORIA-FINAL.md`) — deixar isso
  explícito no schema (`onDelete: Restrict`) evita que uma mudança de
  versão do Prisma altere esse comportamento silenciosamente.

---

## O que esta rodada NÃO cobriu (para não fingir uma completude que não existe)

- Revisão profunda de UX/acessibilidade/dark mode/responsividade em cada
  página do frontend (só auditei a camada de auth/token, que é a
  security-crítica).
- Testes automatizados — não escrevi nenhum; os candidatos mais valiosos
  continuam sendo `debts.service` (arredondamento), `closing.service`
  (idempotência) e agora também `savings`/`cardPurchases` (as duas condições
  de corrida corrigidas aqui são exatamente o tipo de bug que um teste de
  concorrência pega e uma auditoria manual não).
- Uma segunda passada de performance módulo a módulo além do N+1 corrigido
  em `cards` — `financialHealth`, `alerts`, `recommendations` e
  `behavioralAnalysis` são chamados todos juntos no dashboard e não medi o
  custo real de cada um.
- Upgrade efetivo de nenhuma dependência major (só documentei o gap).

---

# PARTE 2 — Continuação (performance, testes, frontend, pendências)

Você pediu para seguir nas quatro frentes de uma vez. Ordem em que tratei:
pendências primeiro (rápido, e duas delas eu não resolvo sem sua decisão),
depois performance, testes e frontend — essas três eu realmente executei,
não só listei.

## Pendências

- **`database.sql` (MySQL) — removido.** Já tinha explicado o motivo na
  Parte 1: o projeto roda em Postgres/Supabase, o arquivo era MySQL e não
  compatível. Atualizei também o `README.md` (removi a seção "Setup local
  (XAMPP)", documentei o `DIRECT_URL` no passo a passo, e mencionei o novo
  `npm test`).
- **`railway.toml` vs `render.yaml` — NÃO mexi.** Continua sem eu saber qual
  provedor está realmente em produção; apagar o errado quebraria seu deploy.
  Preciso que me diga qual dos dois é o real.
- **`AuditLog` (modelo nunca usado) — NÃO mexi.** Implementar é feature nova
  (não é "correção"); remover é mudança de schema. As duas são decisões
  suas, não assumi nenhuma.

## Performance — mais N+1 (o mesmo padrão do `cards.service`, duplicado)

Ao ler os módulos que faltavam, achei o **mesmo** N+1 de `computeUsedLimit`
(1 query por cartão) copiado em mais dois lugares, e um N+1 bem pior em
`behavioralAnalysis`:

| Achado | Antes | Depois | Arquivo |
|---|---|---|---|
| `gatherMetrics` (saúde financeira) fazia 1 query de limite por cartão | N+1 | 1 query batch (`computeUsedLimitsByCard`, extraída de `cards.service`) | `financialHealth.service.js` |
| `refreshAlerts` fazia o mesmo | N+1 | idem | `alerts.service.js` |
| `getBehavioralAnalysis`: receita, despesa, dependência de cartão e evolução de dívida — 1 `aggregate()` por mês, por série. Com `periods=12` chegava a **~36-48 queries individuais** numa única requisição | O(periods × 4) | 4 `groupBy` fixos, não importa quantos períodos | `behavioralAnalysis.service.js` |
| `getDebtInstallmentSchedule`: 1 dívida de cada vez, em série (`for...of` com `await` dentro) | N round-trips sequenciais | mesmas queries, paralelizadas (`Promise.all`) | `projections.service.js` |
| `getProjectionComponents`: 1 round-trip de fatura de cartão por mês projetado, em série (até 24) | 24 round-trips sequenciais | mesmas queries, paralelizadas | `projections.service.js` |

Nos dois últimos (projeções) fiz só a paralelização seura — mesmas queries,
mesma matemática, só concorrentes em vez de uma atrás da outra — e
deliberadamente NÃO tentei eliminar as queries via `groupBy` ali: sem banco
real para testar contra, uma reestruturação mais profunda da matemática de
projeção (que alimenta o simulador "E Se?") tem risco de regressão que não
consigo verificar sozinho neste ambiente. Documento o caminho (groupBy por
`monthId` no intervalo inteiro, de uma vez) para quando você tiver como
testar contra um banco de verdade.

## Testes automatizados

Configurei Jest do zero (o projeto não tinha nenhum framework de teste) e
escrevi **46 testes, todos rodando e passando** — não são só arquivos
"decorativos". Cobertura desta rodada, de propósito focada no que mexi:

- **Funções puras** (sem banco): `addMonths`, `classifyCommitment`,
  `computeInstallmentValue` (arredondamento de parcelas), e
  `firstInvoiceReference`/`clampDay` (regra de qual fatura uma compra cai —
  precisei exportá-las, não eram usadas fora do arquivo).
- **Regressão dos dois fixes de condição de corrida** (A2/A3 da Parte 1):
  testes que falham se alguém remover o lock ou trocar a ordem
  lock→leitura→escrita — é exatamente o tipo de bug que revisão manual não
  pega e um teste de concorrência pega.
- **Regressão do fix de timing attack no login** (A1): confirma que
  `bcrypt.compare` roda mesmo com e-mail inexistente, contra o hash "morto".
- **Regressão do fix 500→404** no `whatIfSimulator` (M3).
- **O refactor de `groupBy`** em `behavioralAnalysis` — a garantia de que a
  série por mês fica na ordem certa com zero-fill correto. Achei isso
  especialmente importante porque, escrevendo esse refactor, quase deixei
  um trecho de código órfão (sintaticamente quebrado) para trás — só o
  syntax-check pegou na hora, mas foi o motivo que me fez escrever teste
  específico para essa lógica.

Rodar: `cd backend && npm test`. Ambiente novo: `jest.config.js`,
`tests/setupEnv.js` (variáveis de ambiente falsas — necessário porque
`env.js` derruba o processo com `process.exit(1)` se faltar alguma, e isso
mataria o Jest inteiro) e `tests/helpers/prismaMock.js` (mock manual do
Prisma — neste sandbox não há acesso de rede para baixar o engine do Prisma,
então usar `jest-mock-extended` com o client real não era viável; o mock
manual não substitui um teste de integração contra Postgres de verdade,
mas testa a lógica de cada service isoladamente).

**Não fiz**: testes de `closing.service` (idempotência do fechamento de
mês — continua no radar, é o mesmo `$transaction` + `$queryRaw` com
`FOR UPDATE`, só não coube nesta rodada) nem nenhum teste de frontend
(React Testing Library não está configurado).

## Frontend — acessibilidade, UX

Fui pelos componentes compartilhados primeiro (maior alavancagem — usados
em toda página) e depois um checkpoint nas 4 páginas de autenticação.
Validei tudo rodando `npm run build` de verdade (Vite) depois de cada
mudança, não só lendo o JSX.

- **`Modal.jsx`** (usado em toda criação/edição/confirmação do app): não
  tinha `role="dialog"`/`aria-modal`/`aria-labelledby`, o botão fechar não
  tinha `aria-label` (só "×"), e o foco não ia para dentro do modal ao abrir
  nem voltava para o botão que abriu ao fechar — quem navega por
  teclado/leitor de tela ficava "perdido" atrás do overlay. Adicionei as
  três coisas, mais um trap de Tab simples (Tab/Shift+Tab circulam dentro
  do modal em vez de vazar para trás dele).
- **`Dropdown.jsx`** (substituiu o `<select>` nativo em ~24 lugares): abria
  e fechava por teclado, mas **não navegava entre as opções** — um
  `<select>` nativo sempre teve isso de graça, e o substituto customizado
  tinha perdido essa capacidade. Adicionei ArrowUp/ArrowDown/Home/End/Enter
  via o padrão `aria-activedescendant` (o foco fica no botão, não precisa
  mover para dentro do portal) e `aria-controls`.
- **`Toast.jsx`**: notificações não eram anunciadas para leitor de tela
  (sem `aria-live`) e o botão fechar não tinha `aria-label`. Adicionado.
- **`FormGroup`** (erro de validação por campo, usado em todo formulário do
  app): adicionei `role="alert"` — uma linha, mas vale para cada campo de
  cada formulário.
- **Login/Registro/Esqueci senha/Redefinir senha**: os banners de erro
  também não tinham `role="alert"`/`role="status"` (corrigido nos 4); o
  formulário de **Registro** (diferente do Login) não tinha `<label>`
  nenhum, só `placeholder` — que não é substituto válido de label para
  leitor de tela e desaparece ao digitar. Adicionei `<label>` visualmente
  oculto (`sr-only`) associado por `id`/`htmlFor` em Registro, Esqueci senha
  e Redefinir senha, e `autoComplete` (`email`, `current-password`,
  `new-password`, `name`) nos 4 formulários — ajuda gerenciador de senha e
  é critério WCAG (1.3.5).
- **Topbar**: botões de mês anterior/próximo eram só ícone sem
  `aria-label`; o campo de busca só tinha `placeholder`. Corrigido.
- **Sidebar**: `<nav>` sem `aria-label` de landmark. Corrigido.

**Verifiquei e NÃO precisou mexer**: os botões de ação nas tabelas
(Editar/Excluir em `ExpensesPage`) já usam texto visível, não são
ícone-only — não tinha o problema que eu esperava encontrar ali. Também não
achei `dangerouslySetInnerHTML` em lugar nenhum (mantém o que already tinha
confirmado na Parte 1).

**Não cobri nesta rodada** (14 páginas é demais para uma passada só):
`CardsPage`, `GoalsPage`, `HistoryPage`, `IncomesPage`,
`PurchaseSimulatorPage`, `ReportsPage`, `SavingsPage`, `SettingsPage`,
`WhatIfSimulatorPage` não tiveram uma revisão linha a linha — só confirmei,
por amostragem, que o padrão de botões com texto (não só ícone) se repete.
Contraste de cores, responsividade em telas muito pequenas e dark mode
tela-a-tela também ficaram de fora.

---

# PARTE 3 — railway.toml removido, AuditLog implementado de verdade

## `railway.toml` — removido

Você confirmou: Render é o provedor real. Apaguei `backend/railway.toml`.
`render.yaml` continua como está (já tinha as env vars corretas).

## `AuditLog` — implementado (não só o schema, o registro de fato)

Você pediu para registrar ações sensíveis de verdade, não deixar o modelo
como estava (schema existente, nunca escrito). Critério que usei para
"sensível": autenticação e qualquer mutação com consequência financeira
direta — não instrumentei toda e qualquer leitura/listagem, isso inflaria o
log sem agregar valor de auditoria.

**Decisão de design mais importante — quando o log é gravado:**
sempre **depois** da operação de negócio já ter commitado (nunca de dentro
do mesmo `$transaction`). Um audit log é preocupação secundária: se gravar
o log falhar por qualquer motivo, isso nunca pode reverter uma
compra/pagamento/depósito que já aconteceu de verdade. O preço é não ser
100% atômico (uma queda de processo bem no meio deixaria uma ação sem
registro); o ganho é que um bug na auditoria não pode nunca quebrar uma
função financeira. Escrevi um teste específico para isso: `register` grava
com `auditLog.create` **falhando de propósito** (rejeitado), e o teste
confirma que a conta é criada normalmente mesmo assim.

`backend/src/modules/auditLog/auditLog.service.js` é o helper único
(`recordAuditLog`) usado em todo lugar — cuida também de serializar BigInt
(não dá pra gravar num campo `Json` sem converter primeiro) e nunca deixa
o erro escapar.

**O que ficou registrado:**

| Módulo | Ações |
|---|---|
| `auth.service.js` | `register`, `login` (só sucesso — falha não tem entidade pra referenciar, ver abaixo), `password_reset_requested`, `password_reset_completed` |
| `debts.service.js` | `create`, `update`, `delete` (soft delete) |
| `cards.service.js` | `create`, `update`, `deactivate` |
| `cardPurchases.service.js` | `create` |
| `savings.service.js` | `deposit`, `withdraw` |
| `goals.service.js` | `create`, `update`, `cancel` |
| `closing.service.js` | `close` (fechamento de mês) |

**O que deliberadamente ficou de fora**, e por quê:
- **Login malsucedido**: `entityId` no schema é `BigInt` obrigatório — não
  dá pra logar uma tentativa contra um e-mail que não existe sem uma
  entidade real pra referenciar. Logar só falhas com e-mail existente
  criaria uma trilha de auditoria inconsistente (às vezes grava falha,
  às vezes não, dependendo se o e-mail existe) — preferi deixar de fora
  por completo a fazer pela metade. Se quiser rastrear tentativas de força
  bruta, isso pede uma tabela separada (sem a restrição de FK pra um user
  existente), não o AuditLog atual.
- **`logout`, `refresh`**: rotina demais (acontece a cada poucos minutos,
  automaticamente) pra valer a pena como "ação sensível" — encheria o log
  de ruído sem ajudar numa auditoria de verdade.
- **`debts.applyPaymentToInstallment`, `goals.contribute`**: pagar uma
  parcela / aportar numa meta são ações frequentes do dia a dia, mais perto
  de "uso normal" do que de "ação sensível que alguém vai querer investigar
  depois". Ficaram de fora desta rodada; são o próximo passo mais óbvio se
  quiser expandir a cobertura.

**Testes**: adicionei verificação de audit log nos testes que já existiam
(cards, cardPurchases, savings) e escrevi suíte nova para os dois módulos
que ainda não tinham nenhum teste — `goals.service` (5 testes) e
`closing.service` (3 testes, incluindo o caminho de fechamento
bem-sucedido, mês já fechado, e mês inexistente). Total agora: **66 testes,
todos passando**.

**Não fiz**: nenhuma rota/tela para *ler* o audit log — você pediu para
registrar as ações, não construir uma tela de auditoria. Se quiser
consultar os registros por enquanto, dá pra usar `npx prisma studio`
direto no banco; um endpoint `GET /audit-log` (com paginação e filtro por
entidade) é natural de adicionar depois, se fizer sentido pro produto.


