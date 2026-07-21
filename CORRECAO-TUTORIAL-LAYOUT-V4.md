# Correção do tutorial e layouts responsivos — V4

## Tutorial interativo

- O início automático agora ocorre somente no dashboard e depois que o marcador explícito de página pronta estiver disponível.
- O sistema aguarda as consultas, skeletons, fontes e animações finitas terminarem.
- Após a prontidão real, existe uma pequena pausa visual para o usuário enxergar a tela antes do overlay.
- Cada rota do tutorial possui seu próprio marcador `data-tutorial-page-ready`.
- O alvo precisa estar visível, estável e quase totalmente dentro do viewport.
- Durante trocas de rota, o card do tutorial desaparece e só retorna quando o próximo alvo estiver pronto.
- O popover ganhou altura máxima, rolagem interna e proteção contra cortes em telas menores.
- A decoração do popover é idempotente, evitando cabeçalhos e barras de progresso duplicadas.
- Páginas vazias e elementos ocultos por breakpoint continuam sendo tratados sem travar o tour.

## Correções de componentes espremidos

- A aba Prioridade foi redesenhada com cards de dívida responsivos.
- Cada dívida mostra progresso, parcela atual, valor da parcela, total pago, saldo devedor, vencimento e ações em áreas separadas.
- Os cards usam largura mínima confortável e mudam automaticamente de três para duas ou uma coluna conforme o espaço real disponível.
- Grids de cartões, dashboard, relatórios e histórico passaram a usar `auto-fit` com largura mínima.
- Tabelas preservam largura mínima e usam rolagem horizontal suave em vez de comprimir valores e textos.
- A primeira coluna das tabelas pode quebrar descrições longas sem apertar os campos numéricos.
- Formulários com duas ou três colunas passam para uma coluna em telas menores.
- Cards-rádio usam layout baseado na largura do contêiner e não forçam quatro opções estreitas.
- Rodapés de modal, cabeçalhos e grupos de ações agora quebram de forma organizada.
- Os modais de dívida e compra foram ampliados.

## Validação

- Build de produção do frontend aprovado.
- 942 módulos processados sem erros.
- Diretório `frontend/dist` atualizado.
- Backend e regras financeiras não foram alterados.
