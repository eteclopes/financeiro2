# Correção de atraso nas Ações Rápidas — V10

## Causa encontrada

Na V9, os handlers dos botões de Receita e Despesa aguardavam (`await`) a resposta da API de categorias antes de executar `setModal(...)`. Em conexões lentas, backend em cold start ou alta latência entre Vercel e Render, o clique parecia não responder.

O botão Fatura fazia uma chamada por cartão de forma sequencial. Assim, o tempo de espera crescia conforme a quantidade de cartões cadastrados.

## Correções

- Receita abre o modal imediatamente e carrega categorias em segundo plano.
- Despesa abre o modal imediatamente e carrega categorias em segundo plano.
- As categorias ficam em cache no componente durante a sessão do Dashboard.
- Fatura abre imediatamente e mostra estado de carregamento.
- As faturas de todos os cartões são buscadas em paralelo com `Promise.allSettled`.
- Uma falha em um cartão continua sem impedir a listagem dos demais.
- Proteção contra respostas antigas sobrescreverem uma abertura mais recente do modal de fatura.
- Nenhuma API, regra financeira ou contrato do backend foi alterado.

## Arquivo funcional alterado

- `frontend/src/components/dashboard/QuickActions.jsx`

## Validações

- Parsing de todos os 51 arquivos JS/JSX do frontend sem erros.
- Verificação estática de que `setModal` ocorre antes das chamadas de rede.
- Verificação de ausência do loop sequencial de cartões na abertura de faturas.
- Integridade do arquivo ZIP validada.
