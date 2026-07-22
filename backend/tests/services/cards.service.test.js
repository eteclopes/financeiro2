jest.mock('../../src/config/prisma', () => require('../helpers/prismaMock').createPrismaMock());

const prismaMock = require('../../src/config/prisma');
const { installDefaults } = require('../helpers/prismaMock');
const { listCards, computeUsedLimitsByCard, computeHistoryCountsByCard, createCard, deactivateCard, activateCard, deleteCard } = require('../../src/modules/cards/cards.service');

beforeEach(() => installDefaults(prismaMock));

describe('computeUsedLimitsByCard — fix de N+1 (1 query em vez de 1-por-cartão)', () => {
  test('soma corretamente por cartão a partir de uma lista única de despesas', async () => {
    prismaMock.expense.findMany.mockResolvedValue([
      { value: 100, cardInvoice: { cardId: 1n } },
      { value: 50, cardInvoice: { cardId: 1n } },
      { value: 200, cardInvoice: { cardId: 2n } },
    ]);

    const result = await computeUsedLimitsByCard([1n, 2n, 3n]);

    expect(result.get('1')).toBe(150);
    expect(result.get('2')).toBe(200);
    expect(result.get('3')).toBeUndefined(); // cartão 3 sem despesas -> sem entrada no Map
    expect(prismaMock.expense.findMany).toHaveBeenCalledTimes(1);
  });

  test('lista vazia de cartões não faz nenhuma query (evita WHERE IN () vazio)', async () => {
    const result = await computeUsedLimitsByCard([]);

    expect(result.size).toBe(0);
    expect(prismaMock.expense.findMany).not.toHaveBeenCalled();
  });
});

describe('computeHistoryCountsByCard — mesmo padrão anti-N+1 de computeUsedLimitsByCard', () => {
  test('conta compras por cartão a partir de 1 groupBy só', async () => {
    prismaMock.cardPurchase.groupBy.mockResolvedValue([
      { cardId: 1n, _count: { _all: 3 } },
      { cardId: 2n, _count: { _all: 0 } },
    ]);

    const result = await computeHistoryCountsByCard([1n, 2n, 3n]);

    expect(result.get('1')).toBe(3);
    expect(result.get('3')).toBeUndefined();
    expect(prismaMock.cardPurchase.groupBy).toHaveBeenCalledTimes(1);
  });

  test('lista vazia de cartões não faz nenhuma query', async () => {
    const result = await computeHistoryCountsByCard([]);

    expect(result.size).toBe(0);
    expect(prismaMock.cardPurchase.groupBy).not.toHaveBeenCalled();
  });
});

describe('listCards — usa 2 queries no total, não importa quantos cartões', () => {
  test('retorna usedLimit/availableLimit corretos para cada cartão, com 1 findMany de cartões + 1 de despesas', async () => {
    prismaMock.card.findMany.mockResolvedValue([
      { id: 1n, limitValue: 1000, name: 'Nubank' },
      { id: 2n, limitValue: 500, name: 'Inter' },
    ]);
    prismaMock.expense.findMany.mockResolvedValue([
      { value: 300, cardInvoice: { cardId: 1n } },
      { value: 600, cardInvoice: { cardId: 2n } }, // > limite -> availableLimit deve ficar em 0, não negativo
    ]);
    prismaMock.cardPurchase.groupBy.mockResolvedValue([{ cardId: 1n, _count: { _all: 2 } }]);

    const result = await listCards(10n);

    expect(result[0]).toMatchObject({ usedLimit: 300, availableLimit: 700, hasHistory: true });
    expect(result[1]).toMatchObject({ usedLimit: 600, availableLimit: 0, hasHistory: false });
    expect(prismaMock.card.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.expense.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.cardPurchase.groupBy).toHaveBeenCalledTimes(1);
  });

  test('usuário sem cartões: retorna lista vazia sem consultar despesas', async () => {
    prismaMock.card.findMany.mockResolvedValue([]);

    const result = await listCards(10n);

    expect(result).toEqual([]);
    expect(prismaMock.expense.findMany).not.toHaveBeenCalled();
  });
});

describe('cards.service — AuditLog', () => {
  test('createCard grava audit log de create', async () => {
    prismaMock.card.create.mockResolvedValue({ id: 9n, userId: 10n, name: 'Nubank' });

    await createCard(10n, { name: 'Nubank', limitValue: 1000, closingDay: 20, dueDay: 5 });

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ entity: 'card', entityId: 9n, action: 'create' }) })
    );
  });

  test('deactivateCard grava audit log de deactivate com valor antigo (active:true) e novo (active:false)', async () => {
    prismaMock.card.findFirst.mockResolvedValue({ id: 9n, userId: 10n, active: true });
    prismaMock.card.update.mockResolvedValue({ id: 9n, active: false });

    await deactivateCard(10n, 9n);

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entity: 'card', entityId: 9n, action: 'deactivate',
          oldValueJson: expect.objectContaining({ active: true }),
          newValueJson: expect.objectContaining({ active: false }),
        }),
      })
    );
  });
});


describe('activateCard — reativação respeita o plano', () => {
  test('Plano Básico bloqueia reativação quando já existem dois cartões ativos', async () => {
    prismaMock.card.findFirst.mockResolvedValue({ id: 9n, userId: 10n, active: false });
    prismaMock.user.findUnique.mockResolvedValue({
      id: 10n, email: 'basico@teste.com', plan: 'basic', planSource: 'basic',
      planGrantedAt: null, planExpiresAt: null, stripeCustomerId: null,
    });
    prismaMock.card.count.mockResolvedValue(2);

    await expect(activateCard(10n, 9n)).rejects.toMatchObject({
      statusCode: 403,
      code: 'PLAN_LIMIT_REACHED',
    });
    expect(prismaMock.card.update).not.toHaveBeenCalled();
  });

  test('reativa cartão quando há vaga e registra auditoria', async () => {
    prismaMock.card.findFirst.mockResolvedValue({ id: 9n, userId: 10n, active: false });
    prismaMock.card.count.mockResolvedValue(1);
    prismaMock.card.update.mockResolvedValue({ id: 9n, userId: 10n, active: true });

    const result = await activateCard(10n, 9n);

    expect(result.active).toBe(true);
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ entity: 'card', entityId: 9n, action: 'activate' }) })
    );
  });
});

describe('deleteCard — exclusão de verdade (não apenas desativar)', () => {
  test('cartão vinculado a despesa fixa recorrente ativa: rejeita com 409 antes de checar qualquer outra coisa', async () => {
    prismaMock.card.findFirst.mockResolvedValue({ id: 7n, userId: 10n });
    prismaMock.fixedExpenseTemplate.count.mockResolvedValue(2);

    await expect(deleteCard(10n, 7n)).rejects.toMatchObject({ code: 'CARD_HAS_LINKED_FIXED_EXPENSES' });
    expect(prismaMock.cardPurchase.findMany).not.toHaveBeenCalled();
  });

  test('cartão sem nenhuma compra/fatura: exclusão simples, sem tocar em expense/cardPurchase/cardInvoice', async () => {
    prismaMock.card.findFirst.mockResolvedValue({ id: 9n, userId: 10n, name: 'Cartão teste' });
    prismaMock.cardPurchase.findMany.mockResolvedValue([]);
    prismaMock.cardInvoice.findMany.mockResolvedValue([]);

    const result = await deleteCard(10n, 9n);

    expect(prismaMock.card.delete).toHaveBeenCalledWith({ where: { id: 9n } });
    expect(prismaMock.expense.findMany).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(result.deletedCounts).toEqual({ purchases: 0, invoices: 0, expenses: 0 });
  });

  test('cartão com histórico todo em meses ABERTOS: apaga em cascata (expenses -> purchases -> invoices -> card) numa transação', async () => {
    prismaMock.card.findFirst.mockResolvedValue({ id: 9n, userId: 10n, name: 'Cartão usado' });
    prismaMock.cardPurchase.findMany.mockResolvedValue([{ id: 101n }, { id: 102n }]);
    prismaMock.cardInvoice.findMany.mockResolvedValue([{ id: 201n }]);
    prismaMock.expense.findMany.mockResolvedValue([
      { id: 301n, month: { status: 'open' } },
      { id: 302n, month: { status: 'open' } },
    ]);

    const result = await deleteCard(10n, 9n);

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.expense.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [301n, 302n] } } });
    expect(prismaMock.cardPurchase.deleteMany).toHaveBeenCalledWith({ where: { cardId: 9n } });
    expect(prismaMock.cardInvoice.deleteMany).toHaveBeenCalledWith({ where: { cardId: 9n } });
    expect(prismaMock.card.delete).toHaveBeenCalledWith({ where: { id: 9n } });
    expect(result.deletedCounts).toEqual({ purchases: 2, invoices: 1, expenses: 2 });
  });

  test('cartão com QUALQUER despesa em mês FECHADO: rejeita com 409 e não apaga nada', async () => {
    prismaMock.card.findFirst.mockResolvedValue({ id: 9n, userId: 10n, name: 'Cartão antigo' });
    prismaMock.cardPurchase.findMany.mockResolvedValue([{ id: 101n }]);
    prismaMock.cardInvoice.findMany.mockResolvedValue([{ id: 201n }]);
    prismaMock.expense.findMany.mockResolvedValue([
      { id: 301n, month: { status: 'open' } },
      { id: 302n, month: { status: 'closed' } }, // um único mês fechado já bloqueia tudo
    ]);

    await expect(deleteCard(10n, 9n)).rejects.toMatchObject({
      statusCode: 409,
      code: 'CARD_HAS_CLOSED_HISTORY',
    });
    expect(prismaMock.card.delete).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  test('cartão inexistente ou de outro usuário: 404, nada é consultado além da checagem de posse', async () => {
    prismaMock.card.findFirst.mockResolvedValue(null);

    await expect(deleteCard(10n, 999n)).rejects.toMatchObject({ statusCode: 404, code: 'CARD_NOT_FOUND' });
    expect(prismaMock.cardPurchase.findMany).not.toHaveBeenCalled();
  });

  test('grava audit log de delete com as contagens do que foi apagado', async () => {
    prismaMock.card.findFirst.mockResolvedValue({ id: 9n, userId: 10n, name: 'Cartão usado' });
    prismaMock.cardPurchase.findMany.mockResolvedValue([{ id: 101n }]);
    prismaMock.cardInvoice.findMany.mockResolvedValue([{ id: 201n }]);
    prismaMock.expense.findMany.mockResolvedValue([{ id: 301n, month: { status: 'open' } }]);

    await deleteCard(10n, 9n);

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ entity: 'card', entityId: 9n, action: 'delete' }),
      })
    );
  });
});

describe('createCard — limite por plano', () => {
  test('Plano Básico bloqueia o terceiro cartão ativo', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 10n,
      email: 'basico@teste.com',
      plan: 'basic',
      planSource: 'basic',
      planGrantedAt: null,
      planExpiresAt: null,
      stripeCustomerId: null,
    });
    prismaMock.card.count.mockResolvedValue(2);

    await expect(createCard(10n, {
      name: 'Terceiro', limitValue: 1000, closingDay: 20, dueDay: 5,
    })).rejects.toMatchObject({
      statusCode: 403,
      code: 'PLAN_LIMIT_REACHED',
      details: expect.objectContaining({ resource: 'activeCards', limit: 2 }),
    });
    expect(prismaMock.card.create).not.toHaveBeenCalled();
  });

  test('Plano Pro não aplica limite de cartões ativos', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 10n,
      email: 'pro@teste.com',
      plan: 'pro',
      planSource: 'manual_test',
      planGrantedAt: new Date(),
      planExpiresAt: null,
      stripeCustomerId: null,
    });
    prismaMock.card.count.mockResolvedValue(20);
    prismaMock.card.create.mockResolvedValue({ id: 99n, userId: 10n, name: 'Novo Pro' });

    const card = await createCard(10n, {
      name: 'Novo Pro', limitValue: 1000, closingDay: 20, dueDay: 5,
    });

    expect(card.id).toBe(99n);
    expect(prismaMock.card.count).not.toHaveBeenCalled();
  });
});
