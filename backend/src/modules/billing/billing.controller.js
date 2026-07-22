const env = require('../../config/env');
const asyncHandler = require('../../utils/asyncHandler');
const AppError = require('../../utils/AppError');
const service = require('./billing.service');

const status = asyncHandler(async (req, res) => {
  res.json(await service.getBillingStatus(req.userId));
});

const checkout = asyncHandler(async (req, res) => {
  res.status(201).json(await service.createCheckoutSession(req.userId));
});

const webhook = asyncHandler(async (req, res) => {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw new AppError('Webhook Stripe não configurado.', 503, 'STRIPE_NOT_CONFIGURED');
  }
  const event = service.verifyStripeSignature(
    req.body,
    req.headers['stripe-signature'],
    env.STRIPE_WEBHOOK_SECRET
  );
  const result = await service.processStripeEvent(event);
  res.json({ received: true, duplicate: result.duplicate });
});

module.exports = { status, checkout, webhook };
