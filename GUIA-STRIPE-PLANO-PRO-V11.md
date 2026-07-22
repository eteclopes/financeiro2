# Guia de ativação do Stripe — Pro Vitalício

A aplicação já está preparada, mas nenhum pagamento real será iniciado até as variáveis do Stripe serem cadastradas.

## 1. Criar produto e preço

No Stripe:

1. Crie um produto, por exemplo `FinanceHub Pro Vitalício`.
2. Crie um preço de **pagamento único**, em BRL.
3. Copie o Price ID, iniciado por `price_`.

## 2. Configurar o backend

No Render, configure:

```env
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PRO_LIFETIME_PRICE_ID=price_...
PRO_LIFETIME_PRICE_LABEL=R$ 99,90 à vista
STRIPE_API_VERSION=2026-06-24.dahlia
```

Para testar antes de ativar cobranças reais, use chaves `sk_test_...` e um Price ID do modo de teste.

Nunca coloque a chave secreta no frontend ou na Vercel.

## 3. Criar o webhook

Cadastre no Stripe o endpoint:

```text
https://SEU-BACKEND.onrender.com/api/billing/webhook
```

Selecione os eventos:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`
- `payment_intent.payment_failed`
- `charge.refunded`

Ao criar o endpoint, selecione a mesma versão configurada em `STRIPE_API_VERSION`.

Copie o Signing Secret do endpoint, iniciado por `whsec_`, e configure no Render:

```env
STRIPE_WEBHOOK_SECRET=whsec_...
```

O checkout só é mostrado como disponível quando as três configurações principais estão presentes.

## 4. Fazer deploy

O build do backend já executa:

```bash
prisma generate
prisma migrate deploy
```

A migração cria as colunas e tabelas de cobrança sem apagar dados existentes.

## 5. Testar em modo de teste

1. Use chaves e preço do modo Teste do Stripe.
2. Entre com uma conta Básica.
3. Acesse `Plano Pro`.
4. Clique em `Comprar acesso Pro`.
5. Conclua o Checkout com um cartão de teste do Stripe.
6. Aguarde o retorno à página do plano.
7. Confirme o selo `PRO ATIVO` e o acesso às áreas avançadas.

Também teste:

- cancelar o checkout;
- repetir um webhook;
- enviar um evento expirado depois de um evento pago;
- reembolso integral;
- tentativa de criar ou reativar o terceiro cartão no Básico;
- criação de mais cartões no Pro.

## 6. Conta Pro interna para teste

Em ambiente local:

```bash
cd backend
npm run seed:pro-test
```

Credenciais locais padrão:

```text
E-mail: teste.pro@financehub.local
Senha: FinanceHubPro@2026
```

Para staging público, configure uma senha exclusiva:

```env
ALLOW_PRO_TEST_ACCOUNT=true
PRO_TEST_EMAIL=seu-email-de-teste@dominio.com
PRO_TEST_PASSWORD=uma-senha-forte-e-exclusiva
```

Depois execute o comando do seed uma vez no ambiente conectado ao banco.

## 7. Antes de abrir vendas

- Troque todas as chaves de teste pelas chaves live.
- Confirme a URL correta do frontend em `FRONTEND_URL`.
- Confirme a URL do webhook live.
- Faça uma compra real de valor baixo ou use um cupom interno controlado.
- Verifique a compra em `billing_purchases` e o evento em `stripe_events`.
- Defina política de reembolso e termos do acesso vitalício.
- Não divulgue a conta Pro de teste.
