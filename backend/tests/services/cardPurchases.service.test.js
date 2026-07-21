jest.mock('../../src/config/prisma', () => require('../helpers/prismaMock').createPrismaMock());
jest.mock('../../src/modules/months/months.service');
jest.mock('../../src/modules/expenses/expenses.service');
jest.mock('../../src/modules/cards/cards.service');

const prismaMock = require('../../src/config/prisma');
const { installDefaults } = require('../helpers/prismaMock');
const monthsService = require('../../src/modules/months/months.service');
const expensesService = require('../../src/modules/expenses/expenses.service');
const cardsService = require('../../src/modules/cards/cards.service');
const { createCardPurchase } = require('../../src/modules/cards/cardPurchases.service');

const CARD = { id: 100n, userId: 10n, active: true, closingDay: 20, dueDay: 5, limitValue: 1000 };

beforeEach(() => {
  installDefaults(prismaMock);

  cardsService.getOwnedCardOrThrow.mockResolvedValue(CARD);
  expensesService.assertCategoryIsValid.mockResolvedValue(undefined);
  monthsService.getOrCreateMonth.mockResolvedValue({ id: 500n });

  prismaMock.cardInvoice.findUnique.mockResolvedValue(null);
  prismaMock.cardInvoice.create.mockResolvedValue({ id: 700n, monthId: 500n, dueDate: new Date() });
  prismaMock.cardInvoice.update.mockResolvedValue({});
  prismaMock.cardPurchase.create.mockImplementation(({ data }) => Promise.resolve({ id: 900n, ...data }));
  prismaMock.expense.create.mockImplementation(({ data }) => Promise.resolve({ id: 1n, ...data }));
});

function basePayload(overrides = {}) {
  return {
    cardId: 100n,
    categoryId: 1n,
    description: 'Compra teste',
    totalValue: 200,
    installmentsCount: 1,
    purchaseDate: new Date(Date.UTC(2026, 6, 5)),
    ...overrides,
  };
}

describe('createCardPurchase — fix de TOCTOU no limite do cartão', () => {
  test('compra dentro do limite disponível é aceita e grava audit log', async () => {
    cardsService.computeUsedLimit.mockResolvedValue(300); // usado: 300, limite: 1000 -> disponível 700

    const result = await createCardPurchase(10n, basePayload({ totalValue: 200 }));

    expect(result.purchase).toBeDefined();
    expect(prismaMock.cardPurchase.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ entity: 'cardPurchase', action: 'create' }) })
    );
  });

  test('compra que ultrapassa o limite disponível é rejeitada com AppError 409, sem criar nada', async () => {
    cardsService.computeUsedLimit.mockResolvedValue(900); // usado: 900, limite: 1000 -> disponível 100

    await expect(createCardPurchase(10n, basePayload({ totalValue: 200 }))).rejects.toMatchObject({
      statusCode: 409,
      code: 'INSUFFICIENT_LIMIT',
    });

    expect(prismaMock.cardPurchase.create).not.toHaveBeenCalled();
  });

  test('REGRESSÃO: o limite só é checado DEPOIS de adquirir o lock por cartão, dentro da transação', async () => {
    const order = [];
    prismaMock.$executeRaw.mockImplementation(() => {
      order.push('lock');
      return Promise.resolve();
    });
    cardsService.computeUsedLimit.mockImplementation(() => {
      order.push('check_limit');
      return Promise.resolve(100);
    });
    prismaMock.cardPurchase.create.mockImplementation(({ data }) => {
      order.push('write');
      return Promise.resolve({ id: 900n, ...data });
    });

    await createCardPurchase(10n, basePayload({ totalValue: 200 }));

    // Antes desta correção, computeUsedLimit rodava ANTES da transação (e
    // portanto antes de qualquer lock) — duas compras concorrentes podiam
    // ler o mesmo usedLimit e passar juntas. Este teste falha se alguém
    // reintroduzir esse padrão.
    expect(order).toEqual(['lock', 'check_limit', 'write']);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  test('cartão desativado é rejeitado antes de tocar em qualquer transação', async () => {
    cardsService.getOwnedCardOrThrow.mockResolvedValue({ ...CARD, active: false });

    await expect(createCardPurchase(10n, basePayload())).rejects.toMatchObject({
      statusCode: 409,
      code: 'CARD_INACTIVE',
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

describe('createCardPurchase — startingInstallment (compra já em andamento) (REGRESSÃO)', () => {
  test('startingInstallment=4 de 12: só gera parcelas 4..12, com valor total/limite já descontado das 3 anteriores', async () => {
    await createCardPurchase(10n, basePayload({
      totalValue: 1200, installmentsCount: 12, startingInstallment: 4,
    }));

    const purchaseData = prismaMock.cardPurchase.create.mock.calls[0][0].data;
    // 1200 em 12x de 100: já "elapsed" 3x100=300 -> resta 900 em 9 parcelas.
    expect(purchaseData).toMatchObject({ totalValue: 900, installmentsCount: 9 });

    // Só 9 parcelas (não 12) devem ser criadas de verdade.
    expect(prismaMock.expense.create).toHaveBeenCalledTimes(9);
    const firstCreated = prismaMock.expense.create.mock.calls[0][0].data;
    expect(firstCreated.description).toBe('Compra teste (4/12)'); // mantém numeração original
  });

  test('sem startingInstallment (padrão 1), continua gerando todas as parcelas normalmente', async () => {
    await createCardPurchase(10n, basePayload({ totalValue: 1200, installmentsCount: 12 }));

    expect(prismaMock.expense.create).toHaveBeenCalledTimes(12);
    const purchaseData = prismaMock.cardPurchase.create.mock.calls[0][0].data;
    expect(purchaseData).toMatchObject({ totalValue: 1200, installmentsCount: 12 });
  });

  test('checagem de limite usa só o valor restante, não a compra inteira original', async () => {
    // Limite disponível de 1000; a compra "original" era de 1200 (não
    // caberia inteira), mas já entrando na parcela 10/12 só restam 200 -
    // que cabe tranquilo.
    await expect(createCardPurchase(10n, basePayload({
      totalValue: 1200, installmentsCount: 12, startingInstallment: 10,
    }))).resolves.toBeDefined();
  });
});
