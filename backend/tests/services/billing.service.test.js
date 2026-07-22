jest.mock('../../src/config/prisma', () => require('../helpers/prismaMock').createPrismaMock());

const prismaMock = require('../../src/config/prisma');
const { installDefaults } = require('../helpers/prismaMock');
const { processStripeEvent } = require('../../src/modules/billing/billing.service');

beforeEach(() => installDefaults(prismaMock));

function checkoutEvent(type, overrides = {}) {
  return {
    id: `evt_${type.replaceAll('.', '_')}`,
    type,
    data: {
      object: {
        id: 'cs_test_1',
        mode: 'payment',
        payment_status: 'paid',
        client_reference_id: '1',
        metadata: { userId: '1', plan: 'pro_lifetime' },
        payment_intent: 'pi_test_1',
        customer: 'cus_test_1',
        amount_total: 9900,
        currency: 'brl',
        ...overrides,
      },
    },
  };
}

describe('Eventos de cobrança Stripe', () => {
  test('um evento expirado atrasado não rebaixa uma compra já paga', async () => {
    prismaMock.billingPurchase.findUnique.mockResolvedValue({
      userId: 1n,
      status: 'paid',
      paidAt: new Date('2026-07-22T00:00:00Z'),
    });

    await processStripeEvent(checkoutEvent('checkout.session.expired', { payment_status: 'unpaid' }));

    expect(prismaMock.billingPurchase.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ status: 'paid' }),
    }));
  });

  test('sucesso assíncrono promove uma compra pendente para paga e libera Pro', async () => {
    prismaMock.billingPurchase.findUnique.mockResolvedValue({ userId: 1n, status: 'pending', paidAt: null });
    prismaMock.user.update.mockResolvedValue({ id: 1n, plan: 'pro' });

    await processStripeEvent(checkoutEvent('checkout.session.async_payment_succeeded'));

    expect(prismaMock.billingPurchase.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ status: 'paid' }),
    }));
    expect(prismaMock.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 1n },
      data: expect.objectContaining({ plan: 'pro', planSource: 'stripe_lifetime' }),
    }));
  });


  test('rejeita uma Session já vinculada a outro usuário', async () => {
    prismaMock.billingPurchase.findUnique.mockResolvedValue({
      userId: 2n,
      status: 'pending',
      paidAt: null,
    });

    await expect(processStripeEvent(checkoutEvent('checkout.session.completed')))
      .rejects.toMatchObject({ code: 'INVALID_STRIPE_METADATA', statusCode: 400 });

    expect(prismaMock.billingPurchase.upsert).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  test('o mesmo eventId é ignorado sem reaplicar efeitos', async () => {
    prismaMock.stripeEvent.findUnique.mockResolvedValue({ id: 1n, eventId: 'evt_duplicate' });
    const result = await processStripeEvent({
      id: 'evt_duplicate',
      type: 'checkout.session.completed',
      data: { object: {} },
    });
    expect(result).toEqual({ duplicate: true });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
