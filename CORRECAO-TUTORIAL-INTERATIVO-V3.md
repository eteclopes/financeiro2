# Correção do Tutorial Interativo — V3

## Problemas corrigidos

- O tutorial iniciava por um `setTimeout` fixo de 900 ms, mesmo quando dashboard e mês ainda estavam carregando.
- A troca de páginas aguardava apenas 350 ms; em conexões lentas o alvo ainda não existia.
- O passo de cartões falhava quando o usuário ainda não possuía cartões cadastrados.
- Elementos ocultos por breakpoint podiam gerar destaque vazio ou posicionamento incorreto.
- O fechamento/destruição do Driver.js podia marcar o tutorial como concluído em situações indevidas.
- Os popovers usavam o visual básico do Driver.js e não acompanhavam a identidade do FinanceHub.

## Nova sincronização

O tutorial agora aguarda, em cada etapa:

1. a rota correta;
2. o documento e as fontes estarem prontos;
3. os skeletons e estados `aria-busy` desaparecerem;
4. o elemento de prontidão existir e estar visível;
5. o alvo existir, estar visível e parar de se mover por vários frames;
6. só então o destaque e o card aparecem.

Não há mais dependência de tempos fixos para determinar se a tela carregou.

## Comportamento em falhas e telas vazias

- Passos incompatíveis com o breakpoint atual são pulados sem congelar o tour.
- Passos indisponíveis não impedem o restante do tutorial.
- Se o primeiro dashboard não carregar, o tour é cancelado sem ser marcado como visto, permitindo nova tentativa.
- A página de cartões possui alvos diferentes para lista preenchida e estado vazio.
- O botão “Ver tutorial novamente” usa o mesmo mecanismo sincronizado, sem timeout manual.

## Redesign dos cards

- Card em vidro claro/escuro com gradientes discretos.
- Bordas e sombras com identidade roxa.
- Ícone e categoria próprios em cada etapa.
- Barra superior de progresso animada.
- Numeração visual do passo.
- Botões Voltar, Próximo e Finalizar redesenhados.
- Estado de carregamento entre rotas com spinner.
- Card inicial especial com resumo do tour.
- Botão de fechar acessível e com tooltip.
- Destaque do elemento com borda roxa, halo e cantos arredondados.
- Responsividade para celulares.
- Respeito a `prefers-reduced-motion`.

## Arquivos principais

- `frontend/src/components/tutorial/TutorialRunner.jsx`
- `frontend/src/components/tutorial/TutorialRunner.css`
- `frontend/src/lib/tutorialDom.js`
- `frontend/src/lib/tutorialSteps.js`
- `frontend/src/store/tutorialStore.js`
- `frontend/src/components/layout/AppLayout.jsx`
- `frontend/src/pages/CardsPage.jsx`
- `frontend/src/pages/SettingsPage.jsx`

## Validação

- Build Vite de produção aprovado.
- 942 módulos processados.
- Diretório `frontend/dist` regenerado.
- Nenhuma alteração nas regras financeiras ou no backend.
