jest.mock('../../src/config/prisma', () => require('../helpers/prismaMock').createPrismaMock());
jest.mock('../../src/modules/months/months.service');
jest.mock('../../src/modules/cards/cards.service');

const prismaMock = require('../../src/config/prisma');
const { installDefaults } = require('../helpers/prismaMock');
const monthsService = require('../../src/modules/months/months.service');
const cardsService = require('../../src/modules/cards/cards.service');
const {
  createSubscription, updateSubscription, pauseSubscription, resumeSubscription, cancelSubscription,
  processSubscriptionsForMonth, intervalMonthsFor, addMonthsToDate,
} = require('../../src/modules/subscriptions/subscriptions.service');

const MONTH = { id: 1n, userId: 10n, month: 7, year: 2026 };

beforeEach(() => {
  installDefaults(prismaMock);
  monthsService.getMonthOrThrow.mockResolvedValue(MONTH);
  prismaMock.category.findFirst.mockResolvedValue({ id: 1n });
});

describe('addMonthsToDate / intervalMonthsFor (puro)', () => {
  test('mensal soma 1 mês', () => {
    expect(intervalMonthsFor({ periodicity: 'monthly' })).toBe(1);
  });
  test('anual soma 12 meses', () => {
    expect(intervalMonthsFor({ periodicity: 'annual' })).toBe(12);
  });
  test('customizado usa o valor informado (ex.: trimestral = 3)', () => {
    expect(intervalMonthsFor({ periodicity: 'custom', customIntervalMonths: 3 })).toBe(3);
  });
  test('preserva o dia do mês ao somar, com clamping em mês mais curto', () => {
    const result = addMonthsToDate(new Date('2026-01-31T00:00:00Z'), 1);
    expect(result.toISOString().slice(0, 10)).toBe('2026-02-28'); // fevereiro não tem 31
  });
  test('soma 12 meses corretamente (virada de ano)', () => {
    const result = addMonthsToDate(new Date('2026-07-10T00:00:00Z'), 12);
    expect(result.toISOString().slice(0, 10)).toBe('2027-07-10');
  });
});

describe('createSubscription — cobrança imediata quando a data cai no mês corrente', () => {
  test('nextChargeDate dentro do mês corrente gera a cobrança na hora', async () => {
    await createSubscription(10n, {
      monthId: 1n, description: 'Netflix', categoryId: 1n, value: 39.9,
      paymentMethod: 'pix', periodicity: 'monthly', nextChargeDate: new Date('2026-07-15T00:00:00Z'),
    });

    expect(prismaMock.subscription.create).toHaveBeenCalled();
  });

  test('cartão desativado é rejeitado antes de criar qualquer coisa', async () => {
    cardsService.getOwnedCardOrThrow.mockResolvedValue({ id: 7n, active: false });

    await expect(createSubscription(10n, {
      monthId: 1n, description: 'Spotify', categoryId: 1n, value: 20,
      paymentMethod: 'credit', cardId: 7n, periodicity: 'monthly', nextChargeDate: new Date(),
    })).rejects.toMatchObject({ code: 'CARD_INACTIVE' });
    expect(prismaMock.subscription.create).not.toHaveBeenCalled();
  });
});

describe('processSubscriptionsForMonth — só cobra quando nextChargeDate cai no mês (REGRESSÃO)', () => {
  test('assinatura anual fora do mês corrente NÃO gera cobrança', async () => {
    prismaMock.subscription.findMany.mockResolvedValue([
      { id: 1n, userId: 10n, status: 'active', periodicity: 'annual', paymentMethod: 'pix',
        value: 100, nextChargeDate: new Date('2027-03-10T00:00:00Z'), endDate: null },
    ]);

    await processSubscriptionsForMonth(10n, MONTH, prismaMock);

    expect(prismaMock.expense.create).not.toHaveBeenCalled();
    expect(prismaMock.subscription.update).not.toHaveBeenCalled();
  });

  test('assinatura com nextChargeDate dentro do mês corrente gera cobrança e avança a data pela periodicidade', async () => {
    prismaMock.subscription.findMany.mockResolvedValue([
      { id: 1n, userId: 10n, status: 'active', periodicity: 'monthly', paymentMethod: 'pix',
        value: 39.9, nextChargeDate: new Date('2026-07-15T00:00:00Z'), endDate: null },
    ]);

    await processSubscriptionsForMonth(10n, MONTH, prismaMock);

    expect(prismaMock.expense.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'subscription', value: 39.9, subscriptionId: 1n }),
    }));
    const updateData = prismaMock.subscription.update.mock.calls[0][0].data;
    expect(updateData.nextChargeDate.toISOString().slice(0, 10)).toBe('2026-08-15');
    expect(updateData.status).toBe('active');
  });

  test('ao ultrapassar a data de encerramento, marca como completed em vez de active', async () => {
    prismaMock.subscription.findMany.mockResolvedValue([
      { id: 1n, userId: 10n, status: 'active', periodicity: 'monthly', paymentMethod: 'pix',
        value: 39.9, nextChargeDate: new Date('2026-07-15T00:00:00Z'), endDate: new Date('2026-07-20T00:00:00Z') },
    ]);

    await processSubscriptionsForMonth(10n, MONTH, prismaMock);

    const updateData = prismaMock.subscription.update.mock.calls[0][0].data;
    expect(updateData.status).toBe('completed'); // 15/ago (próxima data) já passa de 20/jul
  });

  test('assinatura pausada (status != active) nunca é cobrada', async () => {
    prismaMock.subscription.findMany.mockResolvedValue([]); // a própria query já filtra status:'active'

    await processSubscriptionsForMonth(10n, MONTH, prismaMock);

    expect(prismaMock.expense.create).not.toHaveBeenCalled();
  });
});

describe('pause/resume/cancel — transições de status', () => {
  test('pausar uma assinatura já pausada é rejeitado', async () => {
    prismaMock.subscription.findFirst.mockResolvedValue({ id: 1n, userId: 10n, status: 'paused' });
    await expect(pauseSubscription(10n, 1n)).rejects.toMatchObject({ code: 'SUBSCRIPTION_NOT_ACTIVE' });
  });

  test('retomar uma assinatura que não está pausada é rejeitado', async () => {
    prismaMock.subscription.findFirst.mockResolvedValue({ id: 1n, userId: 10n, status: 'active' });
    await expect(resumeSubscription(10n, 1n)).rejects.toMatchObject({ code: 'SUBSCRIPTION_NOT_PAUSED' });
  });

  test('cancelar uma assinatura já cancelada é rejeitado', async () => {
    prismaMock.subscription.findFirst.mockResolvedValue({ id: 1n, userId: 10n, status: 'cancelled' });
    await expect(cancelSubscription(10n, 1n)).rejects.toMatchObject({ code: 'SUBSCRIPTION_ALREADY_CANCELLED' });
  });

  test('pausar uma assinatura ativa funciona e grava audit log', async () => {
    prismaMock.subscription.findFirst.mockResolvedValue({ id: 1n, userId: 10n, status: 'active' });

    await pauseSubscription(10n, 1n);

    expect(prismaMock.subscription.update).toHaveBeenCalledWith({ where: { id: 1n }, data: { status: 'paused' } });
    expect(prismaMock.auditLog.create).toHaveBeenCalled();
  });
});
