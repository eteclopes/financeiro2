# FinançasHub V17 — Métodos de recebimento e pagamento simplificados

## Objetivo

Remover escolhas redundantes que produziam o mesmo efeito financeiro. PIX, débito e transferência utilizavam o mesmo saldo digital e confundiam o usuário.

## Nova regra visual

### Receitas

O formulário exibe somente:

- **Saldo da conta** — adiciona a receita ao saldo disponível e grava a origem como digital.
- **Dinheiro físico** — adiciona a receita e grava a origem como física.

O seletor separado **Origem do dinheiro** foi removido porque repetia a mesma decisão.

### Despesas novas e despesas fixas

O formulário exibe:

- **Saldo da conta**.
- **Cartão de crédito**, somente quando existe pelo menos um cartão ativo cadastrado.
- **Dinheiro físico**.

Ao escolher crédito, o usuário continua selecionando qual cartão será usado; a compra entra na fatura e reduz o limite.

### Pagamento de contas, dívidas e faturas

O formulário exibe somente:

- **Saldo da conta**.
- **Dinheiro físico**.

Crédito não aparece nesses fluxos porque pagar uma conta ou fatura com crédito exigiria criar uma nova compra no cartão, e o backend já bloqueia esse uso incorreto.

## Compatibilidade com dados antigos

Nenhuma migration foi necessária.

O enum do PostgreSQL continua aceitando `cash`, `pix`, `debit`, `credit` e `transfer` para preservar o histórico e a compatibilidade durante deploys. Na interface:

- `pix`, `debit` e `transfer` são apresentados como **Saldo da conta**.
- Novos lançamentos de saldo usam o valor canônico `debit`.
- `cash` aparece como **Dinheiro físico**.
- `credit` aparece como **Cartão de crédito**.

Assim, nenhum registro antigo é apagado ou alterado.

## Arquivos principais alterados

- `frontend/src/lib/paymentMethods.js`
- `frontend/src/pages/IncomesPage.jsx`
- `frontend/src/pages/ExpensesPage.jsx`
- `frontend/src/pages/CardsPage.jsx`
- `frontend/src/components/dashboard/QuickActions.jsx`
- `frontend/src/i18n/translations.js`
- `frontend/scripts/check-payment-methods.mjs`
- `frontend/scripts/check-i18n-coverage.mjs`
- `frontend/package.json`

## Validações

- Receitas possuem somente saldo da conta e dinheiro físico.
- Crédito não aparece sem cartão ativo.
- Cartão inativo não libera a opção de crédito.
- PIX, débito e transferência antigos são exibidos como saldo da conta.
- O seletor duplicado de origem foi removido.
- Traduções novas validadas em inglês, espanhol e russo.
- Sintaxe JS/JSX analisada em 61 arquivos.
- 256 imports relativos validados.
- Backend validado com `node --check`.
- Testes de tutorial, segurança, formulários por mês e internacionalização aprovados.

## Limitação do ambiente

O build do Vite não foi executado porque a instalação offline não possuía o pacote `zustand` em cache e o executável `vite` não ficou disponível. As verificações estáticas e funcionais isoladas foram concluídas.
