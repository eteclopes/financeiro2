# Redesign completo do frontend — FinanceHub

## Escopo

O frontend foi redesenhado visualmente mantendo as rotas, integrações, regras de formulário e chamadas da API existentes.

## Identidade visual

### Tema escuro
- Fundo principal: `#0B0B0F`
- Fundo secundário: `#15151D`
- Cards: `#1B1B26`
- Roxo principal: `#7C3AED`
- Destaque: `#A855F7`
- Texto principal: `#FFFFFF`
- Texto secundário: `#B3B3C6`
- Bordas: `#2D2D3A`

### Tema claro
- Fundo principal: `#F8FAFC`
- Fundo secundário: `#F1F5F9`
- Cards, sidebar e navbar: `#FFFFFF`
- Texto principal: `#0F172A`
- Texto secundário: `#64748B`
- Bordas: `#E2E8F0`
- Roxo principal: `#7C3AED`

### Cores semânticas
- Receita/marca: `#7C3AED`
- Economia/sucesso: `#16A34A`
- Despesas/erro: `#DC2626`
- Alertas: `#F59E0B`
- Informações: `#2563EB`

## Alterações principais

- Nova tela de login em layout dividido e responsivo.
- Novas telas de cadastro, recuperação e redefinição de senha.
- Nova identidade FinanceHub e marca vetorial.
- Sidebar totalmente redesenhada, recolhível e responsiva.
- Topbar translúcida com seletor de mês, notificações e tema.
- Novo sistema de cards, botões, inputs, selects, tabs, badges, tabelas e modais.
- Dashboard refinado com cards animados e gráficos na nova paleta.
- Cartões de crédito com visual de cartão físico, profundidade e brilho.
- Reserva financeira com identidade verde própria.
- Metas com progresso visual, estados e animações.
- Gráficos com tooltips, cores, grades e contraste atualizados.
- Microinterações, hover, elevação, shimmer, entrada progressiva e transições.
- Respeito a `prefers-reduced-motion` para acessibilidade.
- Layout responsivo para desktop, tablet e celular.
- Tema claro e escuro persistente.

## Funcionalidades preservadas

- Autenticação e renovação de sessão.
- Cadastro e recuperação de senha.
- Dashboard e fechamento mensal.
- Receitas, despesas fixas e variáveis.
- Cartões, compras, faturas e pagamentos.
- Reserva, metas, orçamento, histórico e relatórios.
- Simuladores, tendências, alertas, tutorial e configurações.
- Endpoints e contratos atuais do backend.

## Validação

Execute no frontend:

```bash
npm ci
npm run build
```

O diretório `dist` já está incluído e foi gerado com sucesso.
