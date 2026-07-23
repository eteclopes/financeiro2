# FinançasHub V16 — Caixinhas, calculadoras e simulador “E Se?”

## Objetivo

Esta versão parte da V15 e preserva as proteções de segurança e privacidade já implementadas. As alterações ficaram concentradas em três áreas:

1. taxas mensais ou anuais nas calculadoras financeiras;
2. correção da interpretação do cenário “guardar por mês”;
3. criação de caixinhas reais dentro da aba Reservas, integradas ao saldo financeiro.

## Calculadoras

- Removida a calculadora isolada de conversão de taxas.
- Juros compostos aceita rendimento mensal ou anual.
- Financiamento Price e SAC aceita taxa mensal ou anual.
- À vista ou parcelado aceita rendimento mensal ou anual.
- Quitação de dívida aceita taxa mensal ou anual.
- Taxas anuais são convertidas para a taxa mensal equivalente.
- Requisições antigas que ainda enviem `annualRate` ou `annualInvestmentRate` continuam aceitas para reduzir risco de regressão durante o deploy.

## Simulador “E Se?”

No cenário `save_monthly`, guardar dinheiro reduz o saldo livre, mas não reduz o patrimônio total. A API agora devolve métricas separadas:

- `totalReserved`: total transferido para reserva;
- `availableBalanceImpact`: impacto no saldo livre;
- `totalWealthImpact`: impacto no patrimônio total;
- `scenarioTotalCumulative`: saldo livre do cenário somado à reserva acumulada.

Exemplo de R$ 100 por 12 meses:

- total guardado: R$ 1.200;
- movido do saldo livre: R$ 1.200;
- impacto no patrimônio total: R$ 0.

A interface não apresenta mais os R$ 1.200 como prejuízo. O gráfico separa patrimônio, saldo livre e reserva acumulada.

## Caixinhas de reserva

A aba Reservas agora permite:

- Reserva geral;
- Reserva de emergência;
- Viagem;
- Casa;
- Educação;
- Veículo;
- Caixinha personalizada;
- meta de valor por caixinha;
- depósito;
- retirada;
- transferência entre caixinhas;
- edição;
- arquivamento com histórico preservado;
- restauração de caixinha arquivada.

### Regras financeiras

- Depósito com origem `balance` reduz o saldo disponível no Dashboard imediatamente.
- Depósito com origem `external` registra um valor que já estava guardado fora do sistema e não altera o saldo disponível.
- Retirada devolve o valor ao saldo disponível.
- Transferência entre caixinhas altera apenas a distribuição interna:
  - impacto no saldo disponível: zero;
  - impacto no total reservado: zero.
- Toda operação usa lock consultivo por usuário e transação de banco para evitar concorrência e saldo inconsistente.
- A data é referência contábil e de relatório; o efeito financeiro acontece quando a operação é salva.

## Banco de dados

A migration `20260723130000_savings_buckets`:

- cria o enum `SavingsBucketKind`;
- cria a tabela `savings_buckets`;
- adiciona `bucket_id`, `bucket_balance_after` e `transfer_id` em `savings_transactions`;
- cria uma Reserva geral para cada usuário já existente;
- move todo o histórico antigo para essa Reserva geral sem recalcular ou alterar valores;
- preserva `balance_after` como saldo inicial da caixinha durante o backfill;
- cria índices por usuário, caixinha, data e transferência;
- garante uma única caixinha principal por usuário;
- cria um trigger de compatibilidade para o período de rolling deploy.

### Compatibilidade durante o deploy

Enquanto o Render troca a instância antiga pela nova, o backend anterior pode continuar atendendo por alguns instantes. Esse backend não conhece `bucket_id`. O trigger do banco preenche automaticamente a caixinha principal e o saldo dela, evitando falhas nesse intervalo.

A inicialização da primeira caixinha também usa `INSERT ... ON CONFLICT DO NOTHING`, evitando duplicidade ou transação abortada em requisições concorrentes.

## Novos endpoints de Reservas

- `POST /api/savings/buckets`
- `PATCH /api/savings/buckets/:id`
- `DELETE /api/savings/buckets/:id`
- `POST /api/savings/buckets/:id/restore`
- `POST /api/savings/transfer`

Os endpoints antigos de depósito, retirada, edição e exclusão continuam disponíveis. O `bucketId` é opcional para clientes antigos; quando ausente, a caixinha principal é usada.

## Segurança e isolamento

- Todas as rotas de Reservas continuam autenticadas.
- Toda busca de caixinha combina `id` com `userId` autenticado.
- Não é possível movimentar ou editar caixinha de outro usuário.
- A caixinha principal não pode ser arquivada.
- Uma caixinha com saldo não pode ser arquivada.
- Transferências são imutáveis; para desfazer, é necessário realizar uma transferência inversa.
- A finalidade Reserva geral é exclusiva da caixinha principal.
- A auditoria permanece sanitizada e não duplica valores financeiros nos logs.

## Validações executadas

- Sintaxe dos arquivos JavaScript do backend.
- Sintaxe JS/JSX do frontend com parser TypeScript.
- 588 imports relativos verificados.
- Verificação de segurança do backend.
- Verificação de CSP e cabeçalhos do frontend.
- Verificação dos formulários vinculados ao mês financeiro.
- Verificação do tutorial.
- Verificação de internacionalização.
- Traduções específicas das novas telas em inglês, espanhol e russo.
- Teste funcional isolado `npm run check:v16-flows`, cobrindo:
  - taxa mensal e anual equivalente;
  - depósito vindo do saldo;
  - depósito externo;
  - retirada;
  - transferência interna;
  - saldo individual das caixinhas;
  - total reservado;
  - saldo disponível;
  - breakdown de origem;
  - arquivamento e restauração;
  - cenário de R$ 100 por 12 meses sem perda patrimonial.

## Limitação da validação local

O build completo do Vite, `prisma validate` e a suíte Jest não foram executados porque as dependências não estavam instaladas e o ambiente não conseguiu baixá-las. Isso não foi substituído por uma alegação de build aprovado. As verificações estáticas e o teste funcional isolado não usam banco real nem substituem um teste de homologação após o deploy.

## Deploy recomendado

1. Faça backup do PostgreSQL.
2. Envie a V16 para o repositório.
3. Confirme que o build do backend executa `prisma generate` e `prisma migrate deploy`.
4. Faça o deploy do backend primeiro.
5. Confirme nos logs que a migration foi aplicada e a API ficou `Live`.
6. Faça o deploy do frontend.
7. Teste em uma conta separada:
   - saldo antes do depósito;
   - depósito em Reserva de emergência vindo do saldo;
   - retirada;
   - transferência entre duas caixinhas;
   - Dashboard, Histórico e Saúde financeira;
   - financiamento com taxa mensal e anual;
   - simulador “guardar por mês”.

Não execute seed nem comandos destrutivos para aplicar esta versão.
