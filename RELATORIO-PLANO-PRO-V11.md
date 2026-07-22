# FinanceHub V11 — Plano Básico + Pro Vitalício

## Objetivo da versão

Esta versão adiciona uma estrutura de monetização sem transformar o Plano Básico em uma demonstração incompleta. O Básico continua sendo um gestor financeiro funcional; o Pro adiciona capacidade de previsão, comparação e análise.

## Plano Básico

Permanece disponível:

- receitas avulsas e recorrentes;
- despesas variáveis, fixas e dívidas;
- orçamento por categorias;
- cartões, compras, parcelas, faturas e pagamentos;
- até **2 cartões ativos**;
- reserva financeira;
- metas, aportes, edição e cancelamento;
- histórico financeiro;
- relatório mensal com resumo, score, alertas, metas e cartões;
- Dashboard, score de saúde financeira e alertas essenciais.

Cartões desativados e históricos antigos não são apagados. Eles podem ser reativados quando houver vaga no plano. Uma conta que possua mais de dois cartões por ter sido Pro continua enxergando todos os dados, mas não pode cadastrar nem reativar outro cartão enquanto estiver acima do limite.

## Plano Pro Vitalício

### Recursos existentes que passaram a ser Pro

- Simulador de compra.
- Simulador “E Se?”.
- Projeção de meses futuros.
- Tendências comportamentais.
- Recomendações personalizadas.
- Central de análises e dicas inteligentes.
- Relatórios avançados e exportações.

Essas permissões são verificadas no frontend e, nas APIs avançadas, também no backend.

### Recursos novos

- Cartões ativos sem limite do plano.
- Visão consolidada dos cartões: limite total, utilizado, disponível, percentual geral e cartão com maior utilização.
- Dashboard personalizável, com preferências salvas por conta e sincronizadas entre dispositivos.
- Central de planejamento consolidado:
  - uso e disponibilidade dos cartões;
  - melhor janela estimada de compra;
  - separação entre faturas vencidas e previsão futura;
  - estratégia bola de neve para dívidas;
  - ritmo atual e aporte recomendado para metas;
  - alertas inteligentes de limite, comprometimento e metas atrasadas.
- Exportação de relatório em CSV.
- Impressão formatada para salvar em PDF.
- Central de calculadoras financeiras:
  - juros compostos com aportes e inflação;
  - financiamento Price e SAC;
  - conversão de taxa mensal/anual;
  - comparação à vista ou parcelado;
  - antecipação/quitação de dívida;
  - reserva de emergência.

## Segurança de permissões

Foi criada uma camada central de `entitlements`. Ela evita espalhar condições inconsistentes pelo sistema e informa:

- plano efetivo;
- origem do plano;
- validade;
- limites;
- recursos liberados.

As rotas de simuladores, projeções, tendências, recomendações, relatórios, calculadoras, planejamento e preferências do Dashboard exigem Pro no backend.

## Limite de cartões

O limite do Básico é verificado em dois lugares:

1. Frontend: avisa antes de abrir o formulário e direciona para a página do plano.
2. Backend: impede criação ou reativação pela API.

O backend usa uma trava transacional por usuário antes de contar, criar ou reativar o cartão. Isso evita que requisições simultâneas ocupem indevidamente a última vaga do Plano Básico.

## Stripe preparado

A integração foi estruturada para pagamento único do Pro vitalício:

- criação de Stripe Checkout Session em modo `payment`;
- produto/preço definido por Price ID;
- retorno para sucesso ou cancelamento;
- webhook com corpo bruto e verificação HMAC;
- registro idempotente dos eventos recebidos;
- proteção contra eventos fora de ordem;
- liberação do Pro após pagamento confirmado;
- tratamento de falha, expiração e reembolso integral;
- remoção automática do acesso comprado via Stripe quando não existir outra compra paga após reembolso integral;
- suporte a cupons configurados no Stripe;
- versão da API fixada por configuração;
- repetição segura de falha de rede com a mesma chave de idempotência;
- proteção para impedir que uma Checkout Session já vinculada seja transferida para outra conta.

O botão de compra só fica habilitado quando chave secreta, segredo do webhook e Price ID estiverem configurados.

## Conta Pro de teste

Foi incluído o comando:

```bash
cd backend
npm run seed:pro-test
```

Padrões locais:

- E-mail: `teste.pro@financehub.local`
- Senha: `FinanceHubPro@2026`

Em produção o script é bloqueado por padrão. Para staging/produção, é necessário definir `ALLOW_PRO_TEST_ACCOUNT=true` e uma `PRO_TEST_PASSWORD` própria; a senha padrão é recusada nesse ambiente.

O script faz `upsert`: pode ser executado novamente para restaurar o acesso Pro da conta de teste sem criar duplicatas.

## Banco de dados

Nova migração:

`backend/prisma/migrations/20260722020000_pro_lifetime_billing/migration.sql`

Ela adiciona:

- plano e origem do plano ao usuário;
- datas de liberação/expiração;
- ID do cliente Stripe;
- tabela de compras;
- tabela de eventos Stripe processados;
- tabela de preferências persistentes do Dashboard Pro.

Usuários existentes recebem o Plano Básico automaticamente e nenhum dado financeiro anterior é alterado.

## Arquivos de configuração

Foram atualizados:

- `backend/.env.example`;
- `render.yaml`;
- `backend/package.json`;
- schema e migração do Prisma.

Nenhum segredo real do Stripe foi incluído no projeto.

## Validações executadas neste ambiente

- sintaxe dos **124 arquivos JavaScript** do backend, incluindo seeds e testes;
- parsing dos **55 arquivos JS/JSX** do frontend com o parser TypeScript;
- resolução de todos os imports relativos do frontend;
- consistência entre schema Prisma e a nova migração;
- **44 verificações funcionais isoladas** das seis calculadoras, planejamento, permissões e assinatura do webhook;
- limite de dois cartões para Básico e bypass Pro;
- proteção contra evento atrasado, evento repetido e troca indevida do usuário vinculado ao checkout;
- neutralização de CSV Injection nas exportações abertas em planilhas;
- varredura para confirmar que nenhum segredo real do Stripe ou chave privada foi incluído.

Os comandos completos `npm test`, `prisma validate` e `vite build` exigem as dependências instaladas. O ambiente de execução não conseguiu baixá-las por indisponibilidade de rede/cache, portanto essa limitação está documentada sem afirmar uma validação que não ocorreu.
