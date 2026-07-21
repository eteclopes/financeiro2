# Correção de CORS — Vercel + Render

## Erro corrigido

O Render estava respondendo com:

```text
Access-Control-Allow-Origin: financeiro2-git-master-eteclopes-projects.vercel.app
```

Esse valor é inválido porque uma origem precisa incluir o protocolo:

```text
https://financeiro2-git-master-eteclopes-projects.vercel.app
```

## O que mudou no código

- `CORS_ORIGIN` agora aceita uma ou mais URLs separadas por vírgula.
- Um hostname sem protocolo é normalizado automaticamente para `https://`.
- Previews da Vercel são aceitos somente quando pertencem ao projeto e à equipe configurados.
- O domínio recebido é refletido no cabeçalho CORS apenas quando for autorizado.
- Requisições de origens desconhecidas continuam sem o cabeçalho de permissão.
- O link automático para `site.webmanifest` foi removido para evitar o redirecionamento ao SSO em previews protegidos.
- O frontend de produção foi compilado usando `https://financeiro2-8kgt.onrender.com/api`.

## Variáveis necessárias no Render

Abra o backend no Render, entre em **Environment** e configure:

```env
CORS_ORIGIN=https://financeiro2-six.vercel.app
CORS_VERCEL_PROJECT=financeiro2
CORS_VERCEL_TEAM=eteclopes-projects
FRONTEND_URL=https://financeiro2-six.vercel.app
```

Depois use **Manual Deploy > Deploy latest commit** ou **Clear build cache & deploy**.

O domínio atual também pode ser informado explicitamente:

```env
CORS_ORIGIN=https://financeiro2-six.vercel.app,https://financeiro2-git-master-eteclopes-projects.vercel.app
```

## Configuração da Vercel

No projeto do frontend, mantenha esta variável nos ambientes Production e Preview:

```env
VITE_API_URL=https://financeiro2-8kgt.onrender.com/api
```

Depois faça um novo deploy. O arquivo `.env.production` incluído no projeto já contém essa URL como fallback de produção.

## Sobre o erro do manifest e SSO

O endereço `financeiro2-git-master-eteclopes-projects.vercel.app` é um preview protegido pela autenticação da Vercel. O erro do manifesto não era uma falha da API e não bloqueava o cadastro, mas foi eliminado removendo a solicitação automática do manifesto.

Para disponibilizar todo o preview publicamente, use uma destas opções no painel da Vercel:

1. publique/promova o deploy para Production e use o domínio estável; ou
2. em **Settings > Deployment Protection**, desative a autenticação para previews ou crie uma exceção para esse domínio.

## Validação realizada

- 22 suítes aprovadas.
- 178 testes aprovados.
- Teste HTTP de preflight aprovado para o domínio de preview.
- Origem externa desconhecida permaneceu bloqueada.
- Build de produção do frontend aprovado.
- Bundle confirmado com a URL correta do Render.
