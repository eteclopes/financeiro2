jest.mock('../../src/config/prisma', () => require('../helpers/prismaMock').createPrismaMock());

const prismaMock = require('../../src/config/prisma');
const { installDefaults } = require('../helpers/prismaMock');
const {
  buildEntitlements,
  assertPro,
  grantLifetimePro,
} = require('../../src/modules/plans/plans.service');

beforeEach(() => installDefaults(prismaMock));

describe('Planos e permissões', () => {
  test('Básico mantém núcleo completo e limita dois cartões', () => {
    const result = buildEntitlements({ plan: 'basic', planSource: 'basic' });
    expect(result.features.coreFinance).toBe(true);
    expect(result.features.cardsAndInvoices).toBe(true);
    expect(result.features.calculators).toBe(false);
    expect(result.limits.activeCards).toBe(2);
  });

  test('Pro vitalício libera ferramentas avançadas e cartões ilimitados', () => {
    const result = buildEntitlements({
      plan: 'pro', planSource: 'stripe_lifetime', planExpiresAt: null,
    });
    expect(result.isPro).toBe(true);
    expect(result.features.calculators).toBe(true);
    expect(result.features.dashboardPersonalization).toBe(true);
    expect(result.features.planningHub).toBe(true);
    expect(result.limits.activeCards).toBeNull();
  });

  test('assertPro bloqueia conta Básica', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 1n, email: 'a@a.com', plan: 'basic', planSource: 'basic',
      planGrantedAt: null, planExpiresAt: null, stripeCustomerId: null,
    });
    await expect(assertPro(1n)).rejects.toMatchObject({ code: 'PRO_REQUIRED', statusCode: 403 });
  });

  test('grantLifetimePro grava origem e não define expiração', async () => {
    prismaMock.user.update.mockResolvedValue({ id: 1n, plan: 'pro' });
    await grantLifetimePro(1n, 'manual_test');
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 1n },
      data: expect.objectContaining({
        plan: 'pro', planSource: 'manual_test', planExpiresAt: null,
      }),
    });
  });
});
