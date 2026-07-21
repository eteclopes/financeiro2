# FinanceHub — correção completa de usabilidade e responsividade V6

## Problemas reproduzidos

A captura enviada mostrou o formulário de receitas preso dentro da área animada da página, sem cobrir a sidebar e a topbar. Isso acontecia porque o modal usava `position: fixed` dentro de um ancestral com `transform`; nesse cenário o navegador deixa de posicioná-lo em relação à viewport e passa a limitá-lo ao contêiner transformado.

Também foram revisados os relatos de sidebar aberta depois do login, teclado virtual abrindo sozinho, formulários espremidos, cards quebrando linha de forma ruim e tutorial interferindo na primeira carga.

## Correções implementadas

### 1. Sistema global de modais

- Todos os modais agora são renderizados com React Portal diretamente no `document.body`.
- O modal não fica mais preso à rota, sidebar, topbar, animações ou contêineres com `overflow`.
- No celular ele ocupa a área útil inteira e possui cabeçalho fixo, corpo rolável e ações fixas no rodapé.
- No desktop ele permanece centralizado e respeita a altura real da janela.
- Backdrop, foco, Escape, armadilha de Tab, restauração de scroll e safe areas foram tratados.
- Fechar o modal no celular não devolve foco a um campo e, portanto, não reabre o teclado.

### 2. Teclado virtual e viewport real

- Adicionado suporte ao `window.visualViewport`.
- A altura visível é atualizada quando o teclado abre ou fecha.
- Modais se redimensionam para a área realmente disponível.
- A navegação inferior desaparece durante digitação.
- Nenhum input recebe foco automaticamente.
- Login e cadastro removem o foco antes de navegar.
- A meta viewport usa `interactive-widget=resizes-content` e `viewport-fit=cover`.

### 3. Sidebar e navegação mobile

- A sidebar sempre inicia fechada abaixo de 1024 px.
- Depois do login e a cada troca de rota ela continua fechada no celular.
- Possui overlay, botão de fechar, Escape e bloqueio correto do scroll de fundo.
- Largura limitada a `min(86vw, 19rem)`.
- Adicionada barra inferior com Visão, Receitas, Despesas, Cartões e Mais.
- Safe areas de aparelhos com notch foram consideradas.

### 4. Formulários responsivos

- Grids de dois campos passam para uma coluna no celular.
- Cards de seleção não são mais comprimidos; reduzem colunas e quebram linha.
- Forma de pagamento, origem, tipo de compra e opções semelhantes usam largura mínima confortável.
- Botões de ação quebram de maneira organizada e ocupam largura útil no celular.
- Campos têm tamanho de toque adequado e fonte de 16 px no mobile para evitar zoom automático no iOS.
- Categoria nova, switches, dropdowns, datas e textareas foram revisados.

### 5. Dropdowns e seletores

- Posicionamento usa `visualViewport`.
- Menus são limitados à largura e altura visíveis.
- Recalculam posição quando teclado, rolagem ou orientação mudam.
- Z-index foi corrigido para aparecer acima dos cards e abaixo dos modais quando necessário.

### 6. Cards, grids e números

- Removidos `col-span` incompatíveis com grids de uma coluna.
- Cards financeiros usam grids automáticos com largura mínima.
- Valores grandes podem quebrar sem sair do card.
- Cabeçalhos e ações passam a empilhar no celular.
- Linhas com conteúdo variável usam `flex-wrap` para não esmagar valores e botões.

### 7. Tabelas

- Tabelas preservam largura legível e usam rolagem horizontal em telas pequenas.
- Primeira coluna fica fixa no celular para manter contexto durante a rolagem.
- Células de descrição e ações possuem larguras mínimas adequadas.
- Scroll horizontal não desloca a página inteira.

### 8. Tutorial

- Não inicia automaticamente após login.
- Só é carregado quando o usuário solicita em Configurações.
- Driver.js e o CSS do tutorial agora são carregados sob demanda.
- O tutorial continua restrito ao dashboard, sem navegar entre páginas ou disparar consultas adicionais.
- Falhas de alvo encerram o tour sem bloquear o sistema.

### 9. Desempenho e estabilidade mobile

- Animações de entrada em cascata são reduzidas em telas pequenas.
- Efeitos de hover que deslocavam elementos são desativados em dispositivos touch.
- Uso de `100dvh`, safe areas, overscroll controlado e rolagem interna previsível.
- Nenhuma regra financeira ou contrato da API foi alterado.

## Arquivos afetados

Foram alterados 30 arquivos do frontend e criado `MobileNav.jsx`. Os principais são:

- `frontend/src/components/ui/Modal.jsx`
- `frontend/src/components/ui/Motion.jsx`
- `frontend/src/components/ui/Dropdown.jsx`
- `frontend/src/components/layout/AppLayout.jsx`
- `frontend/src/components/layout/Sidebar.jsx`
- `frontend/src/components/layout/MobileNav.jsx`
- `frontend/src/index.css`
- formulários de Receitas, Despesas, Cartões, Metas, Reserva, Orçamento e ações rápidas

## Validações executadas

- Sintaxe de todos os arquivos JS/JSX: aprovada.
- Parse completo do CSS com PostCSS: aprovado.
- Verificação de segurança do tutorial: aprovada, 11 etapas em uma única rota.
- Busca por `autoFocus`: nenhum resultado.
- Busca por `min-h-screen`: removida dos componentes.
- Sintaxe dos arquivos JavaScript do backend: aprovada.
- Estrutura do ZIP: apenas a pasta raiz `financeiro/`.
- Teste de integridade do ZIP: aprovado.

## Limitação do ambiente

O build Vite não pôde ser repetido nesta execução porque o registry npm interno respondeu HTTP 503 ao baixar dependências. O código foi validado por transpile de JS/JSX e parse de CSS, mas a Vercel deverá executar `npm ci` e `npm run build` normalmente durante o novo deploy.
