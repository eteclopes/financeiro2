# Correções implementadas — FinançasPro

## 1. Assinaturas removidas

O módulo de Assinaturas foi eliminado do frontend, backend, rotas, serviços, banco, simuladores e tutorial. A migração converte assinaturas ativas ou pausadas em despesas fixas para evitar perda de dados úteis.

## 2. Despesas fixas no cartão

- Permanecem visíveis na aba **Fixas**.
- Exigem cartão ativo.
- Entram na fatura correspondente ao ciclo de fechamento.
- Consomem o limite disponível imediatamente.
- Não são confundidas com o mês de referência da fatura.
- Não são geradas em meses alternados por colisão entre competência e fatura.
- Edição de valor, vencimento, forma de pagamento ou cartão sincroniza lançamentos ainda não pagos em meses abertos.
- Remoção recalcula o total da fatura e preserva lançamentos pagos ou parciais.

## 3. Faturas e limite

- Vencimento corrigido quando ocorre no mês seguinte ao fechamento.
- Faturas mudam de abertas para fechadas conforme a data.
- Pagamento de fatura exige saldo real suficiente.
- Não é possível pagar uma fatura com cartão de crédito.
- Total apresentado é recalculado a partir dos lançamentos reais.
- Compras recusadas por limite não deixam faturas vazias.
- Criação concorrente de faturas trata conflito de chave única.
- Compras, alterações de limite e desativação de cartão são protegidas por lock transacional e releitura após o lock.

## 4. Saldo acumulado

O saldo não reinicia na virada do mês. Ele é calculado por todo o histórico de:

- receitas efetivamente disponíveis até a data atual;
- despesas realmente pagas;
- pagamentos de faturas e dívidas;
- aportes e devoluções de metas;
- depósitos na reserva originados do saldo;
- retiradas da reserva.

Dashboard e histórico exibem saldo trazido, movimento do mês e saldo acumulado.

## 5. Bloqueio de saldo negativo

Operações que consomem caixa usam lock por usuário e verificam novamente o saldo dentro da transação:

- despesas já pagas na criação;
- pagamento de contas;
- pagamento de parcelas de dívida;
- pagamento de fatura;
- aportes em metas;
- depósitos na reserva com origem no saldo;
- edição ou exclusão de receitas já utilizadas;
- correções de retiradas da reserva.

Duas requisições simultâneas não podem mais gastar o mesmo saldo.

## 6. Datas e recorrências

- Datas padrão do frontend usam o fuso local, evitando o “dia seguinte” após 21h no Brasil.
- Contas que vencem hoje só ficam atrasadas no dia seguinte.
- Operações pagas, aportes e movimentações de reserva não aceitam data futura.
- Receitas recorrentes preservam o dia original; um salário do dia 15 não é mais antecipado para o dia 1.
- Receitas futuras geradas pelo fechamento não entram no saldo antes da data prevista.
- A data real de pagamento é registrada separadamente do vencimento.

## 7. Dívidas

- Pagamentos sem saldo suficiente são rejeitados.
- Pagamento maior ou menor ajusta a parcela seguinte sem duplicar diferenças.
- Exclusão da dívida não apaga parcelas parciais ou pagas.
- Alteração de vencimento atualiza corretamente o status pendente/atrasado dos lançamentos abertos.
- Operações simultâneas são serializadas.

## 8. Metas e reserva

- Aportes em metas reduzem o saldo disponível.
- Cancelamento com devolução não pode ser processado duas vezes simultaneamente.
- Depósitos na reserva distinguem dinheiro vindo do saldo e dinheiro já guardado externamente.
- Retiradas voltam ao saldo disponível.
- Editar ou excluir a última movimentação não pode criar saldo negativo retroativo.
- O detalhamento da reserva nunca mostra componentes negativos.

## 9. Integridade e API

- IDs inválidos retornam erro de validação em vez de HTTP 500.
- Categorias e entidades são verificadas por usuário.
- Alterações em meses fechados permanecem bloqueadas, exceto pagamento de pendências.
- A exclusão de cartões respeita despesas fixas vinculadas e histórico fechado.
- Documentação e arquivos SQL legados incompatíveis com PostgreSQL foram removidos.

## 10. Validação executada

- Backend: **21 suítes, 173 testes aprovados**.
- Frontend: build Vite de produção aprovado.
- Sintaxe de todos os arquivos JavaScript do backend verificada com `node --check`.
- Migração Prisma adicionada para atualização de bancos existentes.

## Implantação

Faça backup e execute:

```bash
cd backend
npm ci
npx prisma generate
npx prisma migrate deploy
node prisma/seed.js
```

Depois gere ou publique o frontend:

```bash
cd frontend
npm ci
npm run build
```
