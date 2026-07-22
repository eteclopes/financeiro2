# Ações rápidas completas — V9

## Objetivo

Igualar os formulários dos botões do Dashboard às opções disponíveis nos módulos completos, preservando as APIs, regras financeiras e correções de estabilidade da V8.

## Alterações realizadas

### Receita

- Seleção e criação de categoria.
- Forma de recebimento.
- Origem digital ou física.
- Observação opcional.
- Opção **Receita recorrente**.
- Validação de valor positivo e categoria.

### Despesa

O botão agora permite escolher entre:

- **Variável**: categoria, forma de pagamento, cartão, status pago/pendente e observação.
- **Fixa**: vencimento, categoria, forma de pagamento, cartão e observação; continua sendo gerada nos próximos meses.
- **Dívida**: valor total, parcelas, vencimento, parcela inicial e pagamento parcial.

As operações continuam usando os serviços existentes:

- `expensesApi.createVariable`
- `expensesApi.createFixed`
- `debtsApi.create`

### Pagar conta e fatura

- Mantidas as mesmas regras de pagamento existentes.
- Informações do lançamento selecionado ficaram mais claras.
- Crédito continua bloqueado como forma de pagar conta ou fatura, conforme o backend.

### Meta

- O aporte agora permite escolher a data.
- Somente metas ativas aparecem.
- Exibição do valor restante para atingir a meta.

## Proteções contra regressões

- O modal só fecha depois de uma gravação bem-sucedida.
- Campos inválidos mantêm o formulário aberto.
- Cartão é obrigatório em compras no crédito.
- Vencimentos, parcelas e parcela inicial são validados antes da chamada à API.
- Mantidas as correções de rolagem e ancoragem do topo dos modais da V8.

## Validações executadas

- Sintaxe verificada em 51 arquivos JS/JSX.
- Verificação automatizada de 18 recursos e integrações das ações rápidas.
- Conferência dos payloads com os validadores do backend.
- O build Vite não foi executado porque as dependências não estavam disponíveis no cache offline do ambiente.
