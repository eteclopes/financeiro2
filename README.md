# FinançasPro

Aplicação de gestão financeira pessoal com frontend React/Vite e API Express/Prisma/PostgreSQL.

## Estrutura

```text
frontend/        interface dos usuários
admin-frontend/  painel administrativo separado
backend/         API compartilhada, regras, Prisma e testes
render.yaml   configuração de deploy do backend no Render
```

O módulo separado de Assinaturas não faz parte do sistema. Cobranças recorrentes, mensalidades e anuidades devem ser cadastradas em **Despesas Fixas**.

## Regras principais

- Toda receita cadastrada aumenta o saldo imediatamente, inclusive quando possui data futura.
- Pagamentos, aportes e depósitos que usam o saldo não podem ultrapassar o valor disponível.
- Compras e despesas fixas no crédito exigem cartão ativo e limite disponível.
- A data real da cobrança é comparada ao fechamento do cartão para definir a fatura.
- O vencimento do cartão define quando a fatura deve ser paga.
- O limite é reduzido quando a cobrança é lançada e liberado quando a fatura é quitada.
- Meses fechados preservam os dados registrados no fechamento.

## Stack

- **Frontend do usuário:** React 18, Vite, React Router, Zustand, Tailwind CSS e Recharts.
- **Frontend administrativo:** React 18 e Vite, implantado separadamente.
- **Backend:** Node.js, Express, Prisma ORM, PostgreSQL, Zod e JWT.
- **Testes:** Jest e verificações estáticas do projeto.

## Backend local

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

- `DATABASE_URL`: conexão usada pela API em execução.
- `DIRECT_URL`: conexão direta usada pelo Prisma Migrate.
- `JWT_ACCESS_SECRET`: segredo forte para autenticação.
- `CORS_ORIGIN`: origem permitida do frontend.
- `FRONTEND_URL`: endereço usado nos links enviados por e-mail.
- `APP_TIME_ZONE`: normalmente `America/Sao_Paulo`.

API local: `http://localhost:3333/api`

Health check: `http://localhost:3333/health`

### Supabase no Render

Use o Transaction Pooler na aplicação e uma conexão direta ou Session Pooler nas migrations:

```env
DATABASE_URL=postgresql://postgres.PROJECT_REF:SENHA@aws-0-REGION.pooler.supabase.com:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://postgres.PROJECT_REF:SENHA@aws-0-REGION.pooler.supabase.com:5432/postgres
```

## Frontend local

```bash
cd frontend
cp .env.example .env
npm ci
npm run dev
```

Exemplo:

```env
VITE_API_URL=http://localhost:3333/api
```

Variáveis `VITE_*` são incorporadas durante o build. Depois de alterá-las em produção, faça um novo deploy do frontend.


## Painel administrativo

O painel em `admin-frontend/` utiliza o mesmo backend, mas é uma aplicação separada. As rotas `/api/admin/*` exigem sessão válida e papel `admin`, consultado no banco em todas as requisições.

Recursos incluídos:

- visão geral de usuários, planos, compras e cadastros;
- busca e detalhes de usuários sem expor valores financeiros pessoais;
- concessão e revogação manual do Plano Pro;
- concessão de papel administrativo com proteção do último administrador;
- revogação de sessões de uma conta;
- exclusão permanente de usuários e dados vinculados, com confirmação reforçada e proteção da própria conta administrativa;
- consulta de compras, auditoria e saúde da API/banco/integrações.

Para criar ou atualizar a primeira conta administrativa:

```bash
cd backend
# configure ADMIN_NAME, ADMIN_EMAIL e ADMIN_PASSWORD no .env
npm run seed:admin
```

Para executar o painel localmente:

```bash
cd admin-frontend
cp .env.example .env
npm ci
npm run dev
```

Painel local: `http://localhost:5174`

## Validação

Backend:

```bash
cd backend
npm test -- --runInBand
npm run check:security
npm run check:v16-flows
npm run check:v18-critical
npm run check:v19-history
npm run check:v20-invoices
npm run check:admin
```

Frontend:

```bash
cd frontend
npm run build
npm run check:tutorial
npm run check:i18n
npm run check:ledger-forms
npm run check:security
npm run check:payments
npm run check:responsive-v18
```

## Produção

Configure no backend:

```env
CORS_ORIGIN=https://SEU-FRONTEND.vercel.app,https://SEU-ADMIN.vercel.app
FRONTEND_URL=https://SEU-FRONTEND.vercel.app
ADMIN_FRONTEND_URL=https://SEU-ADMIN.vercel.app
```

Configure tanto no `frontend/` quanto no `admin-frontend/`:

```env
VITE_API_URL=https://SEU-BACKEND.onrender.com/api
```

O Plano Básico permite até dois cartões ativos. O Plano Pro libera os recursos avançados e limites ampliados. Para criar a conta Pro de teste configurada pelo projeto:

```bash
cd backend
npm run seed:pro-test
```
