# Correção Prisma + Supabase Pooler

## Erro identificado

A API chegou a registrar o usuário com sucesso, mas as consultas seguintes ao
dashboard falharam com o PostgreSQL `26000`:

```text
prepared statement "s10" does not exist
```

O problema ocorre quando o Prisma usa prepared statements através de uma
conexão do pooler do Supabase sem o modo de compatibilidade com PgBouncer.

## Correção implementada

- Nova normalização da URL de runtime em `backend/src/config/databaseUrl.js`.
- Quando o host termina em `.pooler.supabase.com`, o backend garante
  `pgbouncer=true` antes de criar o `PrismaClient`.
- A mesma proteção foi aplicada ao seed.
- `DIRECT_URL` continua separada para migrações.
- `.env.example` e README foram corrigidos.
- Testes unitários foram adicionados para conexão direta, Transaction Pooler e
  Session Pooler.

## Variáveis recomendadas no Render

```env
DATABASE_URL=postgresql://postgres.PROJECT_REF:SENHA@aws-0-REGION.pooler.supabase.com:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://postgres.PROJECT_REF:SENHA@aws-0-REGION.pooler.supabase.com:5432/postgres
```

Também é possível usar a conexão direta do Supabase em `DIRECT_URL`:

```env
DIRECT_URL=postgresql://postgres:SENHA@db.PROJECT_REF.supabase.co:5432/postgres
```

Depois de salvar as variáveis no Render, use **Manual Deploy → Clear build cache
& deploy**.
