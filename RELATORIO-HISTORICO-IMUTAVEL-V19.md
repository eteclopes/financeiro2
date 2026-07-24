# FinançasHub V19 — Histórico mensal imutável

## Problema confirmado

Meses fechados não possuíam um retrato financeiro salvo. Ao abrir um período encerrado, o Dashboard recalculava o saldo usando os registros atuais e apenas filtrava pelas datas contábeis.

Isso permitia que operações criadas depois do fechamento alterassem visualmente um mês antigo, principalmente quando:

- uma despesa do mês seguinte era paga enquanto a data real do computador ainda estava no mês anterior;
- uma movimentação de reserva era criada depois do fechamento com uma data contábil pertencente ao mês encerrado;
- um aporte em meta era associado a um mês fechado;
- receitas recorrentes do mês seguinte eram geradas depois do fechamento;
- um lançamento antigo era atualizado depois de `closed_at`.

O banco não estava perdendo os registros. O problema era o cálculo histórico dinâmico: o mês fechado era recalculado como se ainda estivesse aberto.

## Correção aplicada

### Snapshot financeiro do mês

A tabela `months` agora possui:

- `financial_snapshot` (`JSONB`)
- `snapshot_version` (`SMALLINT`)

Ao fechar um mês, o backend salva dentro da mesma transação um retrato com:

- saldo trazido;
- receitas do mês;
- despesas previstas;
- despesas pagas;
- saldo no encerramento;
- saldo após pendências;
- total reservado;
- movimento líquido das reservas;
- movimento líquido das metas;
- dinheiro físico e saldo digital;
- dívida ativa;
- quantidade de pendências.

Depois disso, o Dashboard de um mês fechado usa esse snapshot e não recalcula os totais com lançamentos futuros.

### Recuperação dos meses já fechados

Meses fechados antes da V19 não possuem snapshot. No primeiro acesso ao Dashboard desses meses, o backend reconstrói o retrato usando `closed_at` como limite:

- receitas criadas depois do fechamento são ignoradas;
- pagamentos alterados depois do fechamento são ignorados;
- depósitos/retiradas de reserva criados depois do fechamento são ignorados;
- aportes criados depois do fechamento são ignorados.

O snapshot reconstruído é salvo e deixa de mudar.

### Proteção contra lançamentos retroativos

Movimentações de reserva e aportes em metas não podem mais ser registrados com uma data pertencente a um mês fechado.

Na tela de Reservas, os botões de guardar, retirar e transferir ficam desativados enquanto o período selecionado estiver encerrado. O usuário deve selecionar um mês aberto.

### Correção adicional de isolamento

A leitura de aportes do Dashboard agora exige também o usuário proprietário da meta. Antes, a consulta filtrava apenas por `monthId`.

## Migration

Arquivo:

`backend/prisma/migrations/20260724010000_immutable_month_snapshots/migration.sql`

A migration não altera receitas, despesas, cartões, dívidas, metas ou reservas. Apenas adiciona duas colunas à tabela `months` e um índice para consultas de meses por usuário/status.

## Deploy

1. Faça backup do PostgreSQL.
2. Publique o backend primeiro.
3. Confirme nos logs que `prisma migrate deploy` concluiu.
4. Publique o frontend.
5. Abra cada mês antigo encerrado uma vez para gerar o snapshot reconstruído.
6. Compare o mês problemático com os valores que existiam no momento do fechamento.

## Validações executadas

- Sintaxe de todos os arquivos JavaScript do backend.
- Parse de 61 arquivos JS/JSX do frontend com o parser TypeScript.
- 600 imports relativos verificados.
- Segurança, formulários, internacionalização, tutorial, pagamentos e responsividade.
- Fluxos V16 e correções críticas V18.
- Teste V19 reproduzindo:
  - receita do mês seguinte;
  - pagamento criado depois do fechamento com data no mês anterior;
  - depósito de reserva retroativo criado depois do fechamento.

O teste confirmou que essas operações não alteram o saldo congelado do mês encerrado.

## Limitação da reconstrução

A reconstrução usa os timestamps `created_at`, `updated_at` e `closed_at`. Ela recupera corretamente operações normais feitas pela aplicação. Alterações manuais feitas diretamente no PostgreSQL, ou dados antigos que tenham sido modificados sem atualizar os timestamps, podem exigir conferência manual.
