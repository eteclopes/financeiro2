# FinançasPro — V30 estabilizada

Gestor financeiro pessoal com dois ambientes isolados:

- `frontend/`: aplicação dos usuários;
- `admin-frontend/`: painel administrativo separado;
- `backend/`: API Express, Prisma e PostgreSQL;
- `.github/workflows/ci.yml`: build, testes e PostgreSQL descartável.

## Invariantes do produto

1. **Receita instantânea:** toda receita cadastrada aumenta o saldo imediatamente, inclusive com competência futura. `incomeDate` é a competência; `effectiveDate` registra quando entrou no caixa.
2. **Histórico Real imutável:** meses anteriores são fechados automaticamente pela data civil validada do dispositivo/fuso. Pagamentos tardios e estornos são eventos novos; fatos antigos não são reescritos.
3. **Simulação isolada:** cada cenário possui perfil, saldo inicial, relógio, meses, cartões, faturas, dívidas, metas e reservas próprios.
4. **Reabertura recalculável:** reabrir uma simulação invalida snapshots e regenera recorrências, parcelas, faturas e saldos derivados a partir daquele mês.
5. **Cartão por ciclo:** cobrança + fechamento escolhem a fatura; vencimento define pagamento. Pagar antecipadamente não encerra o ciclo.
6. **Sem exclusão de dinheiro realizado:** receitas/despesas que já afetaram caixa são estornadas. Exclusão física fica restrita a registros sem efeito financeiro ou a simulações reabertas.
7. **Sessões separadas:** usuário e administrador usam cookies, refresh tokens e audiência JWT diferentes.

A especificação completa está em `backend/docs/FINANCIAL-INVARIANTS.md`.

## Modo Real

- Não há botão manual para fechar mês aberto.
- Antes de qualquer mutação financeira, o backend sincroniza o calendário e encerra meses anteriores ainda abertos.
- O PostgreSQL possui uma segunda barreira que impede reescrita estrutural de mês fechado ou já passado.
- Leituras não criam nem reparam registros; sincronizações e reparos usam comandos `POST` explícitos.
- Mês fechado é exibido exclusivamente pelo snapshot congelado, sem misturar cartões, metas ou dívidas atuais.

## Modo Simulação

- Plano Básico: 1 cenário ativo; Plano Pro: até 10.
- O cenário possui `currentDate` própria e não usa o relógio real.
- O usuário fecha e reabre meses manualmente.
- Ao reabrir, meses posteriores são invalidados e derivados são reconstruídos em ordem cronológica.
- É possível começar com saldo inicial e copiar categorias, cartões, recorrências e dívidas ativas, sem copiar transações reais realizadas.

## Autenticação

Aplicação normal:

```text
/api/auth/*
cookie __Host-financehub_refresh (produção)
audience financehub-web
```

Painel administrativo:

```text
/api/admin-auth/*
cookie __Secure-financehub_admin_refresh (produção, Path=/api/admin-auth)
audience financehub-admin
```

Refresh tokens são de uso único. O frontend serializa a rotação entre abas. Redefinir a senha invalida todos os links anteriores e todas as sessões da conta.

## Desenvolvimento local

Requer Node.js `>=20.19` e PostgreSQL.

### Backend

```bash
cd backend
cp .env.example .env
npm ci
npx prisma generate
npx prisma migrate deploy
node prisma/seed.js
npm run dev
```

### Frontend do usuário

```bash
cd frontend
cp .env.example .env
npm ci
npm run dev
```

### Painel administrativo

```bash
cd admin-frontend
cp .env.example .env
npm ci
npm run dev
```

Nos dois frontends:

```env
VITE_API_URL=http://localhost:3333/api
```

Em produção, `VITE_API_URL` é obrigatória no build. Não existe fallback para a API real no repositório.

## Variáveis essenciais do backend

```env
DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...
CORS_ORIGIN=https://seu-frontend.vercel.app,https://seu-admin.vercel.app
FRONTEND_URL=https://seu-frontend.vercel.app
ADMIN_FRONTEND_URL=https://seu-admin.vercel.app
JWT_ACCESS_SECRET=segredo-aleatorio-com-32-ou-mais-caracteres
JWT_ISSUER=financehub-api
JWT_AUDIENCE=financehub-web
JWT_ADMIN_AUDIENCE=financehub-admin
```

Para recuperação de senha em produção, configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` e `MAIL_FROM`. Sem entrega disponível, a API responde `503`; ela não informa falsamente que enviou o e-mail.

## Deploy

### Render — backend

O `render.yaml` usa:

```text
Root Directory: backend
Build: npm ci && npm run build
Start: npm start
Health: /health
```

`npm run build` executa `prisma generate` e `prisma migrate deploy`. A V30 inclui a migration:

```text
20260802180000_stabilization_v30
```

O health check valida conexão com o banco e presença dessa migration.

### Vercel — frontends

Crie dois projetos no mesmo repositório:

- Root Directory `frontend`;
- Root Directory `admin-frontend`.

Configure `VITE_API_URL` em cada projeto e mantenha as duas URLs fixas na allowlist `CORS_ORIGIN` do Render. URLs de Preview ficam bloqueadas em produção por padrão.

Os arquivos `vercel.json` aplicam CSP, HSTS, `no-store`, proteção contra frame e políticas de permissões. Quando trocar o domínio do backend, atualize também o host de `connect-src` nos dois arquivos para manter a CSP restritiva.

## Administrador

Configure temporariamente:

```env
ADMIN_NAME=Administrador
ADMIN_EMAIL=seu-email@exemplo.com
ADMIN_PASSWORD=senha-forte-com-12-ou-mais-caracteres
```

Execute uma vez:

```bash
cd backend
npm run seed:admin
```

Depois remova `ADMIN_PASSWORD` do ambiente.

## Validação

Backend:

```bash
cd backend
npm run check:all
npm run test:coverage -- --runInBand
```

Frontends:

```bash
cd frontend && npm run build && npm run check:all
cd ../admin-frontend && npm run build && npm run check
```

A CI executa migrations em PostgreSQL 16, testes, cobertura, checks e builds dos dois frontends.
