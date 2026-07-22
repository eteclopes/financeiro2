jest.mock('../../src/config/prisma', () => require('../helpers/prismaMock').createPrismaMock());

const crypto = require('crypto');
const {
  parseStripeSignature,
  verifyStripeSignature,
} = require('../../src/modules/billing/billing.service');

describe('Assinatura de webhook Stripe', () => {
  test('aceita uma assinatura v1 válida dentro da tolerância', () => {
    const secret = 'whsec_test_secret';
    const timestamp = 1_700_000_000;
    const body = Buffer.from(JSON.stringify({ id: 'evt_1', type: 'test', data: { object: {} } }));
    const signature = crypto.createHmac('sha256', secret)
      .update(`${timestamp}.${body.toString('utf8')}`)
      .digest('hex');

    const event = verifyStripeSignature(
      body,
      `t=${timestamp},v1=${signature}`,
      secret,
      timestamp * 1000
    );
    expect(event.id).toBe('evt_1');
  });

  test('rejeita assinatura incorreta', () => {
    const body = Buffer.from('{}');
    expect(() => verifyStripeSignature(
      body,
      't=1700000000,v1=deadbeef',
      'whsec_test_secret',
      1700000000 * 1000
    )).toThrow('Assinatura do webhook Stripe inválida.');
  });

  test('lê múltiplas assinaturas v1', () => {
    expect(parseStripeSignature('t=10,v1=a,v0=old,v1=b')).toEqual({
      timestamp: '10',
      signatures: ['a', 'b'],
    });
  });
});
