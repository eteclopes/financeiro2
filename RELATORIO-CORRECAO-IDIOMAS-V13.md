# FinanceHub V13 — Correção de idiomas e seletor

## Objetivo

- Remover o seletor de idioma do Dashboard, Topbar e telas de autenticação.
- Manter a troca de idioma exclusivamente em Configurações.
- Substituir o dropdown de idioma por um seletor visual responsivo.
- Corrigir textos que permaneciam em português após selecionar inglês, espanhol ou russo.
- Preservar nomes, descrições, cartões e demais dados informados pelo usuário em mensagens dinâmicas.

## Alterações realizadas

### Seletor de idioma

- Removido de `src/App.jsx`.
- Removido de `src/components/layout/Topbar.jsx`.
- Removido o componente antigo `src/components/LocaleSwitcher.jsx`.
- Criado seletor por cartões em `src/pages/SettingsPage.jsx`.
- O seletor usa botões semânticos com `role="radiogroup"`, `role="radio"` e `aria-checked`.
- Layout adaptado para duas colunas no celular e quatro colunas em telas maiores.
- Os nomes nativos dos idiomas não são traduzidos entre si.

### Cobertura de tradução

- Corrigida a tradução dos botões rápidos do Dashboard: Receita, Despesa, Pagar conta, Fatura, Meta e Fechar mês.
- Adicionadas traduções exatas para rótulos curtos, cabeçalhos, status, tabelas e gráficos.
- Ampliada a lista de frases estáticas reconhecidas pela camada de internacionalização.
- Incluídas mensagens relevantes retornadas pelo backend.
- Adicionados padrões seguros para mensagens dinâmicas, incluindo:
  - Exclusão de receita/despesa com descrição.
  - Ativação, desativação e exclusão de cartão com nome.
  - Limite de cartões do Plano Básico.
  - Edição e nova compra em cartão.
  - Cancelamento de metas.
  - Depósitos e retiradas da reserva.
  - Contagens de alertas, metas e parcelas.
- Os valores interpolados e nomes cadastrados pelo usuário são preservados.

### Prevenção de regressões

Foi criado `frontend/scripts/check-i18n-coverage.mjs` e o comando:

```bash
npm run check:i18n
```

Esse teste confirma:

- Tradução dos principais textos em inglês, espanhol e russo.
- Tradução de mensagens dinâmicas críticas.
- Ausência do seletor de idioma fora de Configurações.
- Uso do novo seletor por cartões.

## Validações executadas

- Parser TypeScript aplicado a todos os arquivos JS/JSX do frontend: aprovado.
- `node --check` nos arquivos JavaScript/MJS do frontend: aprovado.
- `node --check` nos arquivos JavaScript do backend e Prisma: aprovado.
- Verificação de todos os imports relativos do frontend: aprovada.
- `npm run check:i18n`: aprovado.
- Comparação com a V12 confirmou alterações limitadas ao frontend de internacionalização e Configurações.

## Limitação do ambiente

O build completo do Vite não foi executado porque as dependências do frontend não estavam disponíveis no ambiente e a instalação pelo npm não foi concluída. A sintaxe JSX, imports e testes de internacionalização foram validados sem alterar dependências do projeto.
