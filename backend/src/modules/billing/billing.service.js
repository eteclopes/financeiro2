const crypto = require('crypto');
const prisma = require('../../config/prisma');
const env = require('../../config/env');
const AppError = require('../../utils/AppError');
const {
  getUserPlan,
  grantLifetimePro,
  revokeStripeProIfNoPaidPurchase,
} = require('../plans/plans.service');

const SIGNATURE_TOLERANCE_SECONDS = 300;

function stripeObjectId(value) {
  if (typeof value === 'string' && value) return value;
  if (value && typeof value === 'object' && typeof value.id === 'string') return value.id;
  return null;
}

function isSettledCheckout(session) {
  return session?.payment_status === 'paid' || session?.payment_status === 'no_payment_required';
}

function isStripeConfigured() {
  return Boolean(
    env.STRIPE_SECRET_KEY
    && env.STRIPE_WEBHOOK_SECRET
    && env.STRIPE_PRO_LIFETIME_PRICE_ID
  );
}

function assertCheckoutConfigured() {
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_PRO_LIFETIME_PRICE_ID) {
    throw new AppError(
      'O checkout do Stripe ainda não foi configurado pelo administrador.',
      503,
      'STRIPE_NOT_CONFIGURED'
    );
  }
}

function parseStripeSignature(header) {
  const pairs = String(header || '').split(',').map((part) => part.trim()).filter(Boolean);
  const timestamp = pairs.find((part) => part.startsWith('t='))?.slice(2);
  const signatures = pairs.filter((part) => part.startsWith('v1=')).map((part) => part.slice(3));
  return { timestamp, signatures };
}

function safeHexEqual(left, right) {
  try {
    const a = Buffer.from(left, 'hex');
    const b = Buffer.from(right, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function verifyStripeSignature(rawBody, signatureHeader, secret, nowMs = Date.now()) {
  if (!Buffer.isBuffer(rawBody)) {
    throw new AppError('Corpo bruto do webhook ausente.', 400, 'INVALID_STRIPE_WEBHOOK');
  }
  const { timestamp, signatures } = parseStripeSignature(signatureHeader);
  const timestampNumber = Number(timestamp);
  if (!timestamp || !Number.isFinite(timestampNumber) || signatures.length === 0) {
    throw new AppError('Assinatura do webhook Stripe inválida.', 400, 'INVALID_STRIPE_SIGNATURE');
  }
  const age = Math.abs(Math.floor(nowMs / 1000) - timestampNumber);
  if (age > SIGNATURE_TOLERANCE_SECONDS) {
    throw new AppError('Webhook Stripe expirado.', 400, 'EXPIRED_STRIPE_SIGNATURE');
  }
  const payload = `${timestamp}.${rawBody.toString('utf8')}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  if (!signatures.some((signature) => safeHexEqual(signature, expected))) {
    throw new AppError('Assinatura do webhook Stripe inválida.', 400, 'INVALID_STRIPE_SIGNATURE');
  }
  try {
    return JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new AppError('Conteúdo do webhook Stripe inválido.', 400, 'INVALID_STRIPE_WEBHOOK');
  }
}

async function stripePost(path, params) {
  assertCheckoutConfigured();
  const idempotencyKey = crypto.randomUUID();
  let response;

  // Uma falha de rede pode acontecer depois de o Stripe ter criado a sessão,
  // mas antes de a resposta chegar ao servidor. A segunda tentativa reutiliza
  // a mesma chave para receber o resultado original, sem criar outro Checkout.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetch(`${env.STRIPE_API_BASE.replace(/\/$/, '')}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Stripe-Version': env.STRIPE_API_VERSION,
          'Idempotency-Key': idempotencyKey,
        },
        body: params.toString(),
      });
      break;
    } catch (error) {
      if (attempt === 1) {
        throw new AppError(
          'Não foi possível conectar ao Stripe. Tente novamente.',
          502,
          'STRIPE_CONNECTION_FAILED'
        );
      }
    }
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || 'Não foi possível iniciar o pagamento.';
    throw new AppError(message, 502, 'STRIPE_REQUEST_FAILED');
  }
  return data;
}

async function getBillingStatus(userId) {
  const [{ user, entitlements }, latestPurchase] = await Promise.all([
    getUserPlan(userId),
    prisma.billingPurchase.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        status: true,
        amountTotal: true,
        currency: true,
        paidAt: true,
        createdAt: true,
      },
    }),
  ]);
  return {
    ...entitlements,
    billingConfigured: isStripeConfigured(),
    priceLabel: env.PRO_LIFETIME_PRICE_LABEL,
    latestPurchase,
    stripeCustomerConnected: Boolean(user.stripeCustomerId),
  };
}

async function createCheckoutSession(userId) {
  assertCheckoutConfigured();
  const { user, entitlements } = await getUserPlan(userId);
  if (entitlements.isPro) {
    throw new AppError('Sua conta já possui acesso Pro.', 409, 'ALREADY_PRO');
  }

  const successUrl = `${env.FRONTEND_URL.replace(/\/$/, '')}/plan?checkout=success&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${env.FRONTEND_URL.replace(/\/$/, '')}/plan?checkout=cancelled`;
  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('line_items[0][price]', env.STRIPE_PRO_LIFETIME_PRICE_ID);
  params.set('line_items[0][quantity]', '1');
  params.set('success_url', successUrl);
  params.set('cancel_url', cancelUrl);
  params.set('client_reference_id', String(user.id));
  params.set('metadata[userId]', String(user.id));
  params.set('metadata[plan]', 'pro_lifetime');
  params.set('metadata[priceId]', env.STRIPE_PRO_LIFETIME_PRICE_ID);
  params.set('payment_intent_data[metadata][userId]', String(user.id));
  params.set('payment_intent_data[metadata][plan]', 'pro_lifetime');
  params.set('payment_intent_data[metadata][priceId]', env.STRIPE_PRO_LIFETIME_PRICE_ID);
  params.set('allow_promotion_codes', 'true');
  params.set('locale', 'auto');
  if (user.stripeCustomerId) {
    params.set('customer', user.stripeCustomerId);
  } else {
    params.set('customer_email', user.email);
    params.set('customer_creation', 'always');
  }

  const session = await stripePost('/v1/checkout/sessions', params);
  if (!session.id || !session.url) {
    throw new AppError('O Stripe não devolveu uma sessão válida.', 502, 'INVALID_STRIPE_SESSION');
  }

  await prisma.$transaction(async (tx) => {
    const paymentIntentId = stripeObjectId(session.payment_intent);
    const customerId = stripeObjectId(session.customer);
    const paid = isSettledCheckout(session);
    await tx.billingPurchase.upsert({
      where: { checkoutSessionId: session.id },
      create: {
        userId,
        checkoutSessionId: session.id,
        paymentIntentId,
        customerId,
        priceId: env.STRIPE_PRO_LIFETIME_PRICE_ID,
        amountTotal: session.amount_total ?? null,
        currency: session.currency ?? null,
        status: paid ? 'paid' : 'pending',
        paidAt: paid ? new Date() : null,
      },
      update: {
        paymentIntentId: paymentIntentId ?? undefined,
        customerId: customerId ?? undefined,
        amountTotal: session.amount_total ?? undefined,
        currency: session.currency ?? undefined,
      },
    });
    if (customerId && !user.stripeCustomerId) {
      await tx.user.update({ where: { id: userId }, data: { stripeCustomerId: customerId } });
    }
    if (paid) await grantLifetimePro(userId, 'stripe_lifetime', tx);
  });

  return { checkoutUrl: session.url, sessionId: session.id };
}

function sessionUserId(session) {
  const raw = session?.metadata?.userId || session?.client_reference_id;
  try { return raw ? BigInt(raw) : null; } catch { return null; }
}

async function applyCheckoutSession(tx, session, forcedStatus = null) {
  if (!session?.id || typeof session.id !== 'string') {
    throw new AppError('Webhook sem checkoutSessionId válido.', 400, 'INVALID_STRIPE_METADATA');
  }
  if (session?.mode && session.mode !== 'payment') {
    throw new AppError('Modo do checkout não reconhecido.', 400, 'INVALID_STRIPE_METADATA');
  }
  if (session?.metadata?.plan !== 'pro_lifetime') {
    throw new AppError('Plano do checkout não reconhecido.', 400, 'INVALID_STRIPE_METADATA');
  }
  if (
    env.STRIPE_PRO_LIFETIME_PRICE_ID
    && session?.metadata?.priceId !== env.STRIPE_PRO_LIFETIME_PRICE_ID
  ) {
    throw new AppError('Preço do checkout não reconhecido.', 400, 'INVALID_STRIPE_METADATA');
  }

  const userId = sessionUserId(session);
  if (!userId) throw new AppError('Webhook sem userId válido.', 400, 'INVALID_STRIPE_METADATA');

  const incomingStatus = forcedStatus || (isSettledCheckout(session) ? 'paid' : 'pending');
  const existing = await tx.billingPurchase.findUnique({
    where: { checkoutSessionId: session.id },
    select: { userId: true, status: true, paidAt: true },
  });

  // O checkout é criado e vinculado ao usuário antes do redirecionamento.
  // Se a mesma Session reaparecer com outro userId, a metadata foi alterada
  // ou há uma inconsistência grave; nunca transfira a compra entre contas.
  if (existing && existing.userId !== userId) {
    throw new AppError('Checkout vinculado a outro usuário.', 400, 'INVALID_STRIPE_METADATA');
  }

  // Eventos do Stripe não têm garantia de ordem. Um "expired" ou "failed"
  // atrasado jamais pode rebaixar uma compra que já foi paga ou reembolsada.
  // Um sucesso pode promover pending/failed/expired para paid, mas nunca deve
  // ressuscitar uma compra que já recebeu reembolso integral.
  let effectiveStatus = incomingStatus;
  if (existing?.status === 'refunded') effectiveStatus = 'refunded';
  else if (existing?.status === 'paid' && incomingStatus !== 'paid') effectiveStatus = 'paid';

  const paymentIntentId = stripeObjectId(session.payment_intent);
  const customerId = stripeObjectId(session.customer);
  const paidAt = effectiveStatus === 'paid' ? (existing?.paidAt || new Date()) : undefined;

  await tx.billingPurchase.upsert({
    where: { checkoutSessionId: session.id },
    create: {
      userId,
      checkoutSessionId: session.id,
      paymentIntentId,
      customerId,
      priceId: session?.metadata?.priceId || env.STRIPE_PRO_LIFETIME_PRICE_ID || 'unconfigured',
      amountTotal: session.amount_total ?? null,
      currency: session.currency ?? null,
      status: effectiveStatus,
      paidAt: effectiveStatus === 'paid' ? paidAt : null,
    },
    update: {
      paymentIntentId: paymentIntentId ?? undefined,
      customerId: customerId ?? undefined,
      amountTotal: session.amount_total ?? undefined,
      currency: session.currency ?? undefined,
      status: effectiveStatus,
      paidAt,
    },
  });
  if (customerId) {
    await tx.user.update({ where: { id: userId }, data: { stripeCustomerId: customerId } });
  }
  if (effectiveStatus === 'paid') await grantLifetimePro(userId, 'stripe_lifetime', tx);
}

async function processStripeEvent(event) {
  if (!event?.id || !event?.type || !event?.data?.object) {
    throw new AppError('Evento Stripe inválido.', 400, 'INVALID_STRIPE_EVENT');
  }

  const alreadyProcessed = await prisma.stripeEvent.findUnique({ where: { eventId: event.id } });
  if (alreadyProcessed) return { duplicate: true };

  try {
    await prisma.$transaction(async (tx) => {
      const duplicate = await tx.stripeEvent.findUnique({ where: { eventId: event.id } });
      if (duplicate) return;
      const object = event.data.object;

      if (event.type === 'checkout.session.completed') {
        await applyCheckoutSession(tx, object, isSettledCheckout(object) ? 'paid' : 'pending');
      } else if (event.type === 'checkout.session.async_payment_succeeded') {
        await applyCheckoutSession(tx, object, 'paid');
      } else if (event.type === 'checkout.session.async_payment_failed') {
        await applyCheckoutSession(tx, object, 'failed');
      } else if (event.type === 'checkout.session.expired') {
        await applyCheckoutSession(tx, object, 'expired');
      } else if (event.type === 'payment_intent.payment_failed' && object.id) {
        await tx.billingPurchase.updateMany({
          where: { paymentIntentId: object.id, status: 'pending' },
          data: { status: 'failed' },
        });
      } else if (event.type === 'charge.refunded' && stripeObjectId(object.payment_intent)) {
        const purchase = await tx.billingPurchase.findFirst({
          where: { paymentIntentId: stripeObjectId(object.payment_intent) },
          select: { id: true, userId: true },
        });
        const fullyRefunded = object.refunded === true || (
          Number.isFinite(object.amount_refunded)
          && Number.isFinite(object.amount)
          && object.amount_refunded >= object.amount
        );
        if (purchase && fullyRefunded) {
          await tx.billingPurchase.update({
            where: { id: purchase.id },
            data: { status: 'refunded', refundedAt: new Date() },
          });
          await revokeStripeProIfNoPaidPurchase(purchase.userId, tx);
        }
      }

      await tx.stripeEvent.create({ data: { eventId: event.id, type: event.type } });
    });
  } catch (error) {
    if (error?.code === 'P2002') return { duplicate: true };
    throw error;
  }
  return { duplicate: false };
}

module.exports = {
  isStripeConfigured,
  parseStripeSignature,
  verifyStripeSignature,
  getBillingStatus,
  createCheckoutSession,
  processStripeEvent,
};
