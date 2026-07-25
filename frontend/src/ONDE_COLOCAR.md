# Onde colocar cada arquivo

Baixe os 3 arquivos e substitua no seu projeto exatamente nestes caminhos:

| Arquivo baixado | Onde colar (apague o antigo, cole este) |
|---|---|
| `authStore.js` | `frontend/src/store/authStore.js` |
| `ProRoute.jsx` | `frontend/src/components/ProRoute.jsx` |
| `App.jsx`      | `frontend/src/App.jsx` |

## Depois de substituir

1. No terminal, dentro da pasta `frontend`:
   ```
   npm run build
   ```
2. Publique o frontend na Vercel (é só frontend — o backend não muda).

## O que isso resolve

- Ao voltar para a aba, o app **não mostra mais a tela cheia "Preparando seu painel"** — entra direto e revalida a sessão em silêncio.
- A **barra lateral e o topo não somem** durante o carregamento; só a área de conteúdo mostra um spinner discreto.
- Páginas Pro **não piscam** o aviso "Recurso Pro" durante a revalidação.

O token continua guardado só na memória (seguro). O que é salvo no navegador é apenas
um marcador `fh_session` (true/false), que não dá acesso a nada sozinho.
