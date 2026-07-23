# Segurança e Privacidade — V15

## Objetivo

Esta versão reforça a privacidade sem alterar cálculos, lançamentos, cartões,
faturas, dívidas, metas, planos ou a estrutura funcional do FinanceHub.

## Mudanças aplicadas

### 1. Audit log sem dados financeiros

Versões anteriores copiavam objetos completos para `audit_log.old_value_json` e
`audit_log.new_value_json`. Esses objetos podiam conter valores, descrições,
observações, nomes e e-mails.

A V15:

- apaga os snapshots antigos por migration;
- preserva usuário, entidade, ação, data e ID do registro;
- guarda somente nomes de campos e estados técnicos, como `status` e `active`;
- nunca copia valores, saldos, limites, descrições, observações ou e-mails.

A auditoria continua útil para saber **quem fez o quê e quando**, sem duplicar o
conteúdo privado.

### 2. Logs de produção minimizados

O backend não registra mais:

- endereço IP;
- query string;
- Referer;
- User-Agent;
- body das requisições;
- e-mail completo;
- senha de seed;
- mensagens completas do driver do banco em erros inesperados.

Os logs mantêm método, rota sem query, status, duração e `requestId`.

### 3. Respostas financeiras sem cache

As respostas da API recebem `Cache-Control: no-store`, `Pragma: no-cache` e
`Expires: 0`, reduzindo persistência em cache do navegador e proxies.

### 4. Sessão reforçada

- JWT aceita somente `HS256`.
- JWT valida emissor, audiência, tipo e identificador do usuário.
- Refresh token continua armazenado apenas como hash no banco.
- Rotação de refresh é atômica: o mesmo token não pode ser consumido duas vezes
  por requisições concorrentes.
- Em produção, o novo cookie usa prefixo `__Host-`, `HttpOnly`, `Secure`,
  `SameSite=None`, `Path=/` e prioridade alta.
- O cookie antigo é aceito durante a transição e removido ao renovar a sessão.

### 5. Proteção contra requisições de origem maliciosa

CORS continua restrito aos domínios configurados e previews confiáveis da
Vercel. Além do CORS, requisições de escrita com cabeçalho `Origin` não
permitido agora são rejeitadas antes de executar a operação.

### 6. Limites de requisição

- limite global;
- limite de autenticação;
- limite específico para renovação de sessão;
- limite de criação de checkout;
- limites para relatórios e cálculos pesados.

### 7. Banco com transporte seguro

Em produção, o backend recusa URLs PostgreSQL que declarem `sslmode=disable`,
`allow` ou `prefer`. URLs de provedores gerenciados sem parâmetro explícito são
mantidas para não quebrar Supabase/Render.

### 8. Frontend endurecido

O deploy da Vercel recebeu:

- Content Security Policy;
- bloqueio de iframe;
- HSTS;
- Referrer Policy `no-referrer`;
- Permissions Policy;
- proteção contra carregamento de scripts de terceiros não autorizados;
- HTML sem cache, mantendo assets versionados com cache imutável.

O script de tema foi movido para arquivo próprio para permitir CSP sem
`unsafe-inline` em JavaScript.

## Limite honesto desta versão

Os valores monetários principais permanecem em colunas `Decimal` no PostgreSQL.
Isso é necessário para somas, filtros, transações, relatórios, alertas,
projeções e verificações de saldo funcionarem corretamente.

Portanto:

- usuários comuns não podem acessar dados de outras contas;
- logs e auditoria não duplicam valores;
- tráfego e armazenamento do provedor continuam protegidos;
- uma pessoa com credencial administrativa/owner do PostgreSQL ainda consegue
  consultar as tabelas brutas.

Criptografar todos os valores em nível de aplicação ou no navegador exigiria
refatorar os cálculos e automações. Essa mudança não foi aplicada nesta versão
porque aumentaria muito o risco de inconsistência financeira.

## Migração

O build do backend já executa:

```bash
prisma generate && prisma migrate deploy
```

A migration `20260723090000_privacy_hardening` limpa os snapshots antigos do
audit log e cria um índice de auditoria por usuário/data.

Faça backup do banco antes de qualquer deploy com migration, mesmo que esta
migration não altere registros financeiros.

## Variáveis novas opcionais

As variáveis possuem defaults seguros, mas podem ser definidas explicitamente:

```env
JWT_ISSUER=financehub-api
JWT_AUDIENCE=financehub-web
```

Ao mudar esses valores, access tokens existentes deixam de ser aceitos, mas o
refresh token válido emite um novo access token.

## Checklist do Render/Supabase

1. Remover as variáveis temporárias da conta Pro de teste.
2. Voltar o Start Command para `npm start`.
3. Nunca cadastrar `DATABASE_URL`, `DIRECT_URL`, JWT ou Stripe na Vercel.
4. Manter segredos somente no backend do Render.
5. Restringir quem possui acesso ao painel do banco.
6. Ativar MFA nas contas Render, Supabase, Vercel, GitHub e Stripe.
7. Rotacionar senhas/chaves após compartilhamento acidental.
8. Não abrir Prisma Studio publicamente.
9. Usar o SQL opcional em `backend/docs/create-masked-support-role.sql.example`
   para uma conta de suporte que veja apenas contagens e estados.

## Verificações

```bash
cd backend
npm run check:security
npm test

cd ../frontend
npm run check:i18n
npm run check:tutorial
npm run check:ledger-forms
npm run build
```
