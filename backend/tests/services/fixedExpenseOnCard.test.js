jest.mock('../../src/config/prisma', () => require('../helpers/prismaMock').createPrismaMock());
jest.mock('../../src/modules/months/months.service');
jest.mock('../../src/modules/cards/cards.service');
jest.mock('../../src/modules/cards/cardPurchases.service');

const prismaMock = require('../../src/config/prisma');
const { installDefaults } = require('../helpers/prismaMock');
const monthsService = require('../../src/modules/months/months.service');
const cardsService = require('../../src/modules/cards/cards.service');
const cardPurchasesService = require('../../src/modules/cards/cardPurchases.service');
const { createFixedExpense } = require('../../src/modules/expenses/expenses.service');

// Cartão fecha dia 18, vence dia 25.
const CARD = { id: 5n, userId: 10n, active: true, closingDay: 18, dueDay: 25, name: 'Nubank' };

beforeEach(() => {
  installDefaults(prismaMock);
  monthsService.getMonthOrThrow.mockResolvedValue({ id: 60n, month: 7, year: 2026, status: 'open' });
  monthsService.assertMonthIsOpen.mockReturnValue(undefined);
  cardsService.getOwnedCardOrThrow.mockResolvedValue(CARD);
  cardPurchasesService.createFixedCardCharge.mockResolvedValue({ expense: { id: 99n } });
  prismaMock.category.findFirst.mockResolvedValue({ id: 3n, userId: 10n });
  prismaMock.fixedExpenseTemplate.create.mockImplementation(({ data }) => Promise.resolve({ id: 77n, ...data }));
});

describe('Despesa fixa no cartão — o cartão define o vencimento', () => {
  test('o dia digitado pelo usuário é IGNORADO no crédito', async () => {
    await createFixedExpense(10n, {
      monthId: 60n, description: 'Netflix', categoryId: 3n, value: 40,
      dueDay: 5,                    // usuário digitou 5...
      paymentMethod: 'credit', cardId: 5n,
    });

    const data = prismaMock.fixedExpenseTemplate.create.mock.calls[0][0].data;
    // ...mas quem manda é o cartão (vence dia 25). Deixar o 5 valer faria a
    // cobrança cair na fatura errada.
    expect(data.dueDay).toBe(25);
  });

  test('fora do crédito, o dia escolhido continua valendo', async () => {
    await createFixedExpense(10n, {
      monthId: 60n, description: 'Aluguel', categoryId: 3n, value: 1200,
      dueDay: 5, paymentMethod: 'debit',
    });

    const data = prismaMock.fixedExpenseTemplate.create.mock.calls[0][0].data;
    expect(data.dueDay).toBe(5);
    expect(data.cardId).toBeNull();
  });

  test('a cobrança no crédito vai para a fatura, não para o saldo', async () => {
    await createFixedExpense(10n, {
      monthId: 60n, description: 'Spotify', categoryId: 3n, value: 22,
      dueDay: 1, paymentMethod: 'credit', cardId: 5n,
    });

    // Quem cria a cobrança é o fluxo de cartão (entra na fatura e consome
    // limite); nenhuma despesa comum é criada fora dela.
    expect(cardPurchasesService.createFixedCardCharge).toHaveBeenCalled();
    expect(prismaMock.expense.create).not.toHaveBeenCalled();
  });

  test('cartão desativado recusa a despesa fixa', async () => {
    cardsService.getOwnedCardOrThrow.mockResolvedValue({ ...CARD, active: false });
    await expect(createFixedExpense(10n, {
      monthId: 60n, description: 'X', categoryId: 3n, value: 10,
      dueDay: 1, paymentMethod: 'credit', cardId: 5n,
    })).rejects.toMatchObject({ code: 'CARD_INACTIVE' });
  });
});
