# FinançasPro

Aplicação de gestão financeira pessoal com frontend React/Vite e API Express/Prisma/PostgreSQL.

## Estado desta versão

Esta versão consolida o sistema financeiro em torno de quatro regras principais:

1. **Saldo acumulado real:** o dinheiro que sobra continua disponível nos meses seguintes.
2. **Pagamentos protegidos:** contas, dívidas, faturas, metas e depósitos na reserva não podem consumir mais do que o saldo disponível.
3. **Cartão de crédito real:** compras e despesas fixas no crédito exigem um cartão, entram na fatura e reduzem o limite disponível.
4. **Recorrências centralizadas:** o módulo separado de Assinaturas foi removido. Serviços mensais, anuidades e cobranças recorrentes devem ser cadastrados em **Despesas Fixas**.

O detalhamento das mudanças está em [`CORRECOES-IMPLEMENTADAS.md`](./CORRECOES-IMPLEMENTADAS.md).

## Stack

- Frontend: React 18, Vite, React Router, Zustand, Tailwind CSS e Recharts.
- Backend: Node.js, Express, Prisma ORM, PostgreSQL, Zod e JWT.
- Testes: Jest.

## Estrutura

```text
frontend/   interface web
backend/    API, regras financeiras, Prisma e testes
render.yaml configuração de deploy do backend no Render
```

## Atualizando um banco existente

A migração `20260721030000_financial_core_fixes`:

- adiciona competência e data real de pagamento às despesas;
- preserva o dia das receitas recorrentes;
- converte assinaturas ativas/pausadas em despesas fixas;
- remove tabelas, relações e enums do módulo Assinaturas;
- remove o cenário obsoleto `cancel_subscription`;
- cria proteção contra duplicidade de despesas fixas por competência.

Antes de aplicar em produção, faça backup do banco.

```bash
cd backend
npm ci
npx prisma generate
npx prisma migrate deploy
node prisma/seed.js
```

## Configuração local do backend

```bash
cd backend
cp .env.example .env
npm ci
npx prisma generate
npx prisma migrate deploy
node prisma/seed.js
npm run dev
```

Variáveis essenciais:

- `DATABASE_URL`: use o **Transaction Pooler** do Supabase, porta `6543`, com `?pgbouncer=true`.
- `DIRECT_URL`: use a conexão direta ou o **Session Pooler**, porta `5432`, para o Prisma Migrate.
- `JWT_ACCESS_SECRET`: segredo forte para autenticação.
- `CORS_ORIGIN`: URL permitida do frontend.
- `FRONTEND_URL`: URL usada nos links de recuperação de senha.
- `APP_TIME_ZONE`: use `America/Sao_Paulo` para datas brasileiras.

API local: `http://localhost:3333/api`

Health check: `http://localhost:3333/health`

### Prisma + Supabase no Render

A aplicação usa duas conexões diferentes:

```env
DATABASE_URL=postgresql://postgres.PROJECT_REF:SENHA@aws-0-REGION.pooler.supabase.com:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://postgres.PROJECT_REF:SENHA@aws-0-REGION.pooler.supabase.com:5432/postgres
```

`DATABASE_URL` é usada durante a execução da API. O código também adiciona
`pgbouncer=true` automaticamente quando detecta um host `pooler.supabase.com`,
evitando o erro PostgreSQL `26000: prepared statement does not exist`.

`DIRECT_URL` é usada somente pelo Prisma CLI para `generate`, `migrate deploy`,
`db pull` e operações equivalentes. Após alterar essas variáveis no Render, faça
**Clear build cache & deploy**.

## Configuração local do frontend

```bash
cd frontend
cp .env.example .env
npm ci
npm run dev
```

Defina `VITE_API_URL`, por exemplo:

```env
VITE_API_URL="http://localhost:3333/api"
```

## Validação

Backend:

```bash
cd backend
npm test -- --runInBand
```

Frontend:

```bash
cd frontend
npm run build
```

A V10, usada como base, possuía uma suíte validada anteriormente. Nesta V11 foram adicionados testes para planos, Stripe, calculadoras, planejamento e preferências do Dashboard. Neste ambiente sem dependências instaladas, foram executadas verificações estáticas completas e **44 cenários funcionais isolados**; execute os dois comandos acima após `npm install` para a validação integral antes do deploy.

## Regras importantes de uso

- Crédito sempre exige cartão ativo e limite disponível.
- Uma despesa fixa no crédito aparece na aba **Fixas** e também na fatura do cartão.
- Pagar a fatura libera o limite correspondente aos lançamentos quitados.
- Receitas futuras não ficam disponíveis antes da data configurada.
- Meses fechados preservam o histórico; pagamentos de pendências antigas continuam possíveis e são contabilizados na data real do pagamento.
- Aportes em metas e depósitos na reserva com origem no saldo reduzem o caixa disponível.

### URL da API no frontend

No ambiente de produção do frontend, configure:

```env
VITE_API_URL=https://SEU-BACKEND.onrender.com/api
```

Depois de alterar uma variável `VITE_*`, faça um novo deploy/build do frontend,
pois o Vite incorpora esse valor durante a compilação. A aplicação também
normaliza a URL e adiciona `/api` automaticamente caso o domínio seja informado
sem esse sufixo.

## CORS no Render e previews da Vercel

No backend do Render, configure as variáveis abaixo e faça um novo deploy:

```env
CORS_ORIGIN=https://financeiro2-six.vercel.app
CORS_VERCEL_PROJECT=financeiro2
CORS_VERCEL_TEAM=eteclopes-projects
FRONTEND_URL=https://financeiro2-six.vercel.app
```

`CORS_ORIGIN` também aceita várias URLs separadas por vírgula. Não use apenas o
hostname: prefira sempre a origem completa, começando por `https://`.

Os endereços `*-git-*-eteclopes-projects.vercel.app` são previews. Caso estejam
protegidos pelo login da Vercel, arquivos como o manifesto podem ser redirecionados
para o SSO. Para teste público, use o domínio de produção ou desative a proteção
para o preview específico nas configurações de Deployment Protection da Vercel.

## Plano Pro Vitalício (V11)

A V11 mantém o gestor financeiro no Plano Básico e adiciona uma camada Pro com simuladores, projeções, tendências, recomendações, relatórios, calculadoras e cartões ativos sem limite do plano.

- Guia técnico: `RELATORIO-PLANO-PRO-V11.md`
- Configuração do pagamento: `GUIA-STRIPE-PLANO-PRO-V11.md`
- Criar conta Pro local de teste: `cd backend && npm run seed:pro-test`

O Plano Básico permite até 2 cartões ativos. O limite é validado tanto no frontend quanto no backend.

### Central de planejamento Pro

A área `/planning` consolida cartões, faturas futuras e vencidas, dívidas e metas. As recomendações são somente leitura e não alteram lançamentos automaticamente. O Dashboard Pro também pode ser personalizado, com preferências persistidas no banco por usuário.
