# FinanceHub — Redesign Interativo V2

## Objetivo

Evoluir o redesign anterior para uma experiência mais expressiva e dinâmica, sem adicionar bibliotecas pesadas de animação e sem alterar contratos da API ou regras financeiras.

## Mudanças principais

### Movimento e profundidade

- Aurora ambiente animada nos modos claro e escuro.
- Spotlight suave que acompanha o cursor na área autenticada.
- Transições de entrada entre rotas com blur e deslocamento mínimos.
- Cards com brilho direcional, elevação e resposta ao ponteiro.
- Modais com luz ambiente, borda superior luminosa e entrada aprimorada.
- Tabelas com resposta sutil da primeira coluna ao passar o mouse.
- Respeito automático a `prefers-reduced-motion`.

### Novos componentes leves

Foi criado `frontend/src/components/ui/Motion.jsx` com:

- `AnimatedNumber`: anima números e valores monetários.
- `ChoiceCards`: grupos de escolha com semântica de radio button.
- `SegmentedControl`: controle segmentado acessível para filtros e gráficos.
- `ToggleSwitch`: switch visual para opções booleanas.
- `Spotlight`: iluminação local baseada no ponteiro.

Nenhuma nova dependência foi adicionada.

### Dashboard

- Saldo acumulado com contador animado.
- Hero com gradiente em movimento, gráfico decorativo e órbitas sutis.
- Cards de reserva, dinheiro físico e dívidas com spotlight.
- Gráfico Receitas × Despesas alternável entre barras e fluxo.
- Projeção alternável entre área e linhas.
- Animações aprimoradas do Recharts.

### Formulários

Formas de pagamento e recebimento passaram a usar cards-rádio visuais em:

- ações rápidas do dashboard;
- receitas;
- despesas variáveis;
- despesas fixas;
- edição de despesas fixas;
- pagamento de contas;
- pagamento de faturas;
- cartões.

Checkboxes importantes foram substituídos por switches em:

- despesa já paga;
- receita recorrente;
- pagamento parcial de dívidas;
- devolução de aportes de metas.

### Cartões

- Cartões com efeito 3D leve.
- Brilho animado no hover.
- Chip decorativo.
- Limite disponível com contador animado.
- Pagamento de fatura com cards-rádio.

### Metas e reserva

- Cards de metas com órbita decorativa e ring interativo.
- Progresso monetário animado.
- Origem do depósito na reserva usando cards-rádio explicativos.
- Saldo da reserva animado.

### Simuladores

- Tipos do simulador “E Se?” apresentados como cards de cenário.
- Resultado acumulado animado.
- Simulador de compras com escolha visual entre à vista e parcelado.
- Valores de impacto mensal e anual animados.

### Login e cadastro

- Aurora animada na área pública.
- Cards flutuantes com exemplos de movimentações.
- Mini gráfico com barras respirando.
- Continuidade visual entre claro e escuro.

### Configurações

- Seletor visual de modo claro/escuro.
- Categorias com controle segmentado animado.

## Peso e desempenho

O projeto continua sem biblioteca de animação externa. Comparado ao redesign anterior:

- JavaScript principal comprimido: aumento inferior a 0,2 kB.
- CSS comprimido: aumento aproximado de 0,5 kB.
- Build processado com 940 módulos.

As animações usam principalmente `transform`, `opacity` e gradientes, favorecendo aceleração por GPU. Movimentos contínuos são decorativos e desativados/reduzidos quando o sistema operacional solicita menos movimento.

## Validação

- `npm run build`: aprovado.
- Vite 5.4.21: aprovado.
- 940 módulos processados.
- Backend, CORS, Prisma/Supabase e regras financeiras preservados da versão anterior.
