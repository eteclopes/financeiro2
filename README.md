# Sistema de Gestão Financeira Pessoal Inteligente

## Status do projeto

Concluído nesta entrega:
- Etapa 1 — Arquitetura Funcional (`arquitetura-etapas-1-2.md`)
- Etapa 2 — Modelagem do Banco (`arquitetura-etapas-1-2.md`)
- Etapa 3 — Modelagem SQL inicial (substituída por `backend/prisma/schema.prisma`, ver Etapa 4 — `database.sql` foi removido por ser MySQL e o projeto rodar em Postgres/Supabase)
- Etapa 4 — `backend/prisma/schema.prisma`
- Etapa 5 — Arquitetura backend (estrutura de pastas, camadas, middlewares)
- Etapa 6 — Autenticação completa (cadastro, login, logout, refresh, recuperação de senha)
- Etapa 7 — Receitas (criar, editar, excluir, listar, recorrência)
- Etapa 8 — Despesas fixas e variáveis
- Etapa 9 — Parcelamentos (despesas de prioridade)
- Etapa 10 — Pagamento flexível e excedente
- Etapa 11 — Cartões de crédito, compras parceladas e faturas
- Etapa 12 — Saldo Guardado
- Etapa 13 — Metas
- Etapa 14 — Dashboard
- Etapa 15 — Fechamento Mensal
- Frontend (parcial) — Login, Cadastro, Recuperação de Senha e Dashboard em React, conectados à API real

Pendente para as próximas entregas: saúde financeira, alertas, simuladores, projeções, relatórios; telas de Receitas, Despesas, Dívidas, Cartões, Saldo Guardado e Metas no frontend (Etapas 16-19).

Etapa 20 (auditoria final): uma primeira rodada independente foi feita — ver `AUDITORIA-CLAUDE.md` para a lista completa de achados (segurança, condições de corrida, N+1, deploy) e o que foi corrigido. Testes automatizados começaram a existir (`backend/tests`, `npm test`) cobrindo os módulos financeiros mais críticos, mas ainda não é cobertura completa nem inclui o frontend.

## Setup local

O projeto roda em **PostgreSQL** (Supabase) — o `schema.prisma` está configurado para isso (`provider = "postgresql"`). `database.sql` (MySQL/XAMPP) foi removido: era de uma fase anterior do projeto e não é compatível com o banco atual; o Prisma Migrate é a fonte única da verdade do schema.

1. Crie um projeto no [Supabase](https://supabase.com) (ou use outro Postgres).
2. Dentro de `backend/`:
   ```bash
   cp .env.example .env
   # preencha DATABASE_URL (connection pooling) e DIRECT_URL (conexão
   # direta) — as duas ficam na mesma tela do Supabase: Project Settings >
   # Database > Connection string. Sem DIRECT_URL, "prisma generate" e
   # "prisma migrate" falham (o pooler não suporta as operações do migrate).
   npm install
   npm run prisma:migrate -- --name init
   node prisma/seed.js   # popula categorias padrão
   npm run dev
   ```
3. API disponível em `http://localhost:3333/api` (teste com `GET /api/health`).
4. `npm test` roda a suíte de testes automatizados (Jest) — cobre hoje a lógica pura de cálculo (parcelas, faturas) e os módulos financeiros mais sensíveis a condição de corrida (saldo guardado, limite de cartão). Ainda não é cobertura completa; ver `AUDITORIA-CLAUDE.md`.
