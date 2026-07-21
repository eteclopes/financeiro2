# FinanceHub — Formulários compactos V7

## Objetivo

Reduzir o tamanho visual excessivo dos formulários sem reintroduzir cortes, overflow ou problemas com o teclado virtual.

## Alterações

- Modais deixaram de ocupar 100% da tela no celular.
- No celular, os formulários abrem como painéis inferiores compactos, com altura baseada no conteúdo.
- Altura padrão limitada a aproximadamente 82% da viewport.
- Formulários muito longos continuam acessíveis por rolagem interna.
- Modais curtos usam limite ainda menor.
- Modal de dívida pode usar mais altura somente quando necessário.
- Larguras desktop reduzidas para 460, 560, 680 e 820 px conforme o tipo de formulário.
- Cabeçalhos, paddings, espaços verticais e área de ações foram reduzidos.
- Opções compactas usam duas colunas em celulares normais.
- Em aparelhos extremamente estreitos, as opções voltam para uma coluna para não comprimir texto.
- Descrições secundárias dos radios são ocultadas no celular para reduzir altura.
- Formulário de Receita passou de tamanho grande para médio.
- Formulários de Despesa Variável e Despesa Fixa usam seletores compactos.
- Formulário de Reserva usa seleção compacta da origem.
- Formulários de Compra e Dívida distribuem três campos em três colunas quando houver espaço.
- Modal de nova dívida foi reduzido de extra grande para grande.

## Validação

- Todos os arquivos JavaScript e JSX foram analisados pelo parser do TypeScript: sem erros de sintaxe.
- `src/index.css` foi analisado pelo parser do PostCSS: sem erros.
- Estrutura do ZIP validada com apenas a pasta `financeiro` na raiz.
- Nenhum `node_modules`, `.git` ou arquivo de credencial pessoal foi incluído.

## Observação de build

O `npm ci` não concluiu no ambiente de execução por indisponibilidade/timeout do registry. O pacote mantém `package-lock.json` e deve ser compilado normalmente pela Vercel com `npm ci` e `npm run build`.
