# Correção V20 — Faturas no Dashboard e Automação

Data: 01/08/2026

## Escopo

Esta versão corrige os dois defeitos relatados:

1. A fatura aparecia no modo de pagamento individual do Dashboard, mas não podia ser selecionada.
2. A automação não calculava corretamente a fatura do mês seguinte nem conseguia pagá-la no fechamento.

## 1. Pagamento individual da fatura

### Causa

O componente `frontend/src/components/ui/Dropdown.jsx` aceitava apenas elementos `<option>` diretos. O Dashboard envia as opções agrupadas em `<optgroup>` (Contas, Dívidas e Faturas). O grupo era interpretado como uma opção sem valor, então a fatura aparecia visualmente, mas a seleção enviava `undefined`.

### Correção

O Dropdown agora:

- percorre `<option>` e `<optgroup>` recursivamente;
- preserva o valor real de cada fatura (`invoice:<id>`);
- exibe os títulos dos grupos sem transformá-los em opções;
- mantém opções desabilitadas e navegação por teclado;
- aponta o destaque/rolagem para a opção real, e não para o cabeçalho do grupo.

O backend de pagamento não precisou ser alterado: o modo individual já reutilizava a transação segura do pagamento em lote, enviando uma única fatura.

## 2. Automação da fatura do próximo mês

### Causa principal

Ao criar uma despesa fixa no cartão, o backend substituía o dia informado pelo usuário pelo dia de vencimento do cartão. Com isso, o vencimento da fatura era usado como se fosse a data da cobrança.

Exemplo do erro antigo:

- cobrança real: dia 5;
- fechamento: dia 10;
- vencimento: dia 17;
- o sistema trocava a cobrança para dia 17;
- como 17 é depois do fechamento 10, a cobrança era enviada para a fatura posterior.

A automação procurava a fatura no mês correto, mas a cobrança havia sido vinculada a outro ciclo.

### Correção da regra do cartão

Agora existem três conceitos separados:

- **dia da cobrança:** vem da despesa fixa;
- **fechamento:** decide em qual fatura a cobrança entra;
- **vencimento:** vem do cartão e determina quando a fatura deve ser paga.

A despesa fixa reduz o limite quando é lançada. O saldo disponível só é reduzido quando a fatura é paga.

### Correção da prévia da automação

A prévia do próximo mês agora considera:

- faturas reais já existentes;
- faturas abertas que vencem dentro do mês-alvo;
- despesas fixas no cartão que ainda são apenas templates e serão geradas no fechamento;
- a regra de fechamento e vencimento de cada cartão;
- cobranças já geradas, evitando duplicidade na projeção.

A prévia e a execução usam o mesmo critério padrão: faturas fechadas ou com vencimento até o fim do mês-alvo. A opção de antecipação continua permitindo incluir faturas abertas de meses posteriores.

### Execução no fechamento

O fluxo validado é:

1. o mês atual é fechado;
2. o próximo mês é criado/obtido;
3. receitas, despesas fixas e parcelas do próximo mês são geradas;
4. a cobrança fixa é vinculada à fatura correta;
5. a automação é executada no novo mês;
6. a fatura encontrada é enviada ao pagamento em lote;
7. saldo mínimo e saldo disponível continuam sendo respeitados.

## Arquivos principais alterados

- `frontend/src/components/ui/Dropdown.jsx`
- `frontend/src/components/dashboard/QuickActions.jsx`
- `frontend/src/pages/ExpensesPage.jsx`
- `frontend/scripts/check-payment-methods.mjs`
- `backend/src/modules/expenses/expenses.service.js`
- `backend/src/modules/automations/automations.service.js`
- `backend/tests/services/fixedExpenseOnCard.test.js`
- `backend/tests/services/automations.service.test.js`
- `backend/scripts/check-v20-invoices-automation.js`
- `backend/package.json`

## Validações executadas

Passaram:

- verificação sintática de todos os arquivos JavaScript do backend;
- `check:security`;
- `check:v16-flows`;
- `check:v18-critical`;
- `check:v19-history`;
- novo `check:v20-invoices`;
- `check:tutorial`;
- `check:i18n`;
- `check:ledger-forms`;
- `check:security` do frontend;
- `check:payments`;
- `check:responsive-v18`.

O novo teste de regressão confirma:

- seleção individual com grupos;
- preservação do dia real da cobrança;
- inclusão de fatura aberta que vence no mês-alvo;
- projeção de cobrança fixa ainda não gerada;
- envio da fatura ao pagamento automático.

## Limitação do ambiente de validação

Não foi possível executar `npm install`, o build Vite e a suíte Jest completa porque o registro npm disponível no ambiente não forneceu os pacotes do projeto. Isso não foi tratado como falha do código. As verificações locais sem dependências externas e os cenários direcionados passaram.

## Atenção aos dados já existentes

A versão anterior substituía e descartava o verdadeiro dia da cobrança das despesas fixas no cartão. Portanto, não existe uma migração segura capaz de adivinhar esse dia.

Após publicar esta versão, revise uma vez cada despesa fixa antiga no cartão e informe o dia real em que o estabelecimento faz a cobrança. Novas despesas e futuras edições passarão a preservar esse valor corretamente.

## Comando de regressão

No backend:

```bash
npm run check:v20-invoices
```

Resultado esperado:

```text
OK: seleção individual, ciclo da cobrança e automação da fatura do próximo mês validados.
```
