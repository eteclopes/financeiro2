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

- `DATABASE_URL`: conexão de runtime com PostgreSQL.
- `DIRECT_URL`: conexão direta usada pelo Prisma Migrate.
- `JWT_ACCESS_SECRET`: segredo forte para autenticação.
- `CORS_ORIGIN`: URL permitida do frontend.
- `FRONTEND_URL`: URL usada nos links de recuperação de senha.
- `APP_TIME_ZONE`: use `America/Sao_Paulo` para datas brasileiras.

API local: `http://localhost:3333/api`

Health check: `http://localhost:3333/health`

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

Nesta entrega, a suíte possui **21 arquivos de teste e 173 testes aprovados**, e o build de produção do frontend foi concluído com sucesso.

## Regras importantes de uso

- Crédito sempre exige cartão ativo e limite disponível.
- Uma despesa fixa no crédito aparece na aba **Fixas** e também na fatura do cartão.
- Pagar a fatura libera o limite correspondente aos lançamentos quitados.
- Receitas futuras não ficam disponíveis antes da data configurada.
- Meses fechados preservam o histórico; pagamentos de pendências antigas continuam possíveis e são contabilizados na data real do pagamento.
- Aportes em metas e depósitos na reserva com origem no saldo reduzem o caixa disponível.
