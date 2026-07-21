const prisma = require('../../config/prisma');
const AppError = require('../../utils/AppError');
const monthsService = require('../months/months.service');
const { round2 } = require('../../utils/math');
const { recordAuditLog } = require('../auditLog/auditLog.service');

const INTERVAL_MONTHS = { monthly: 1, annual: 12 };

/**
 * Quantos meses somar para chegar na próxima cobrança, dado o tipo de
 * periodicidade. 'custom' usa o valor informado pelo usuário (ex.:
 * trimestral = 3) — os outros dois têm intervalo fixo.
 */
function intervalMonthsFor(subscription) {
  return subscription.periodicity === 'custom'
    ? subscription.customIntervalMonths
    : INTERVAL_MONTHS[subscription.periodicity];
}

/**
 * Soma N meses a uma data, preservando o dia quando possível — mesmo
 * comportamento de clamping usado em expenses.service.dueDateFromDay (dia
 * 31 + 1 mês num mês de 30 dias cai no dia 30, não estoura pro mês seguinte).
 */
function addMonthsToDate(date, months) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth(); // 0-indexed
  const day = date.getUTCDate();
  const targetMonthIndex = month + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDayOfTargetMonth)));
}

async function assertCategoryIsValid(userId, categoryId) {
  const category = await prisma.category.findFirst({
    where: { id: categoryId, type: 'expense', OR: [{ userId }, { userId: null }] },
  });
  if (!category) {
    throw new AppError('Categoria inválida.', 422, 'INVALID_CATEGORY');
  }
}

async function getOwnedSubscriptionOrThrow(userId, subscriptionId) {
  const subscription = await prisma.subscription.findFirst({ where: { id: subscriptionId, userId } });
  if (!subscription) {
    throw new AppError('Assinatura não encontrada.', 404, 'SUBSCRIPTION_NOT_FOUND');
  }
  return subscription;
}

async function listSubscriptions(userId) {
  return prisma.subscription.findMany({
    where: { userId },
    include: { category: true, card: true },
    orderBy: [{ status: 'asc' }, { nextChargeDate: 'asc' }],
  });
}

/**
 * Gera a cobrança de uma assinatura para o mês informado — mesmo mecanismo
 * de despesa fixa vinculada a cartão (expenses.service.createFixedExpense):
 * se paga no cartão, nasce direto na fatura (tipo 'card', não desconta
 * saldo até a fatura ser paga); senão, nasce como despesa tipo
 * 'subscription' pendente comum.
 */
async function chargeSubscription(subscription, month, tx) {
  const isCard = subscription.paymentMethod === 'credit' && subscription.cardId;
  const dueDate = subscription.nextChargeDate;

  if (isCard) {
    const card = await tx.card.findUnique({ where: { id: subscription.cardId } });
    if (card && card.active) {
      const cardPurchasesService = require('../cards/cardPurchases.service'); // lazy: evita import circular
      const ref = cardPurchasesService.firstInvoiceReference(dueDate, card.closingDay);
      const invoice = await cardPurchasesService.getOrCreateInvoice(card, ref.month, ref.year, tx);

      await tx.expense.create({
        data: {
          userId: subscription.userId,
          monthId: invoice.monthId,
          type: 'card',
          description: subscription.description,
          categoryId: subscription.categoryId,
          dueDate,
          value: subscription.value,
          status: 'pending',
          subscriptionId: subscription.id,
          cardInvoiceId: invoice.id,
          paymentMethod: subscription.paymentMethod,
        },
      });
      await tx.cardInvoice.update({ where: { id: invoice.id }, data: { totalValue: { increment: Number(subscription.value) } } });
      return;
    }
    // Cartão da assinatura foi desativado/removido: cai para o caminho
    // comum abaixo em vez de travar a cobrança silenciosamente.
  }

  await tx.expense.create({
    data: {
      userId: subscription.userId,
      monthId: month.id,
      type: 'subscription',
      description: subscription.description,
      categoryId: subscription.categoryId,
      dueDate,
      value: subscription.value,
      status: 'pending',
      subscriptionId: subscription.id,
      paymentMethod: subscription.paymentMethod,
    },
  });
}

/**
 * Roda no fechamento de mês (ver closing.service.js), para cada assinatura
 * ativa do usuário: cobra e avança a data se `nextChargeDate` cair dentro
 * do mês recém-aberto. A maioria dos meses não faz nada para a maioria das
 * assinaturas anuais/customizadas — só cobra quando a data realmente chega.
 */
async function processSubscriptionsForMonth(userId, month, tx) {
  const subscriptions = await tx.subscription.findMany({ where: { userId, status: 'active' } });
  const monthStart = new Date(Date.UTC(month.year, month.month - 1, 1));
  const monthEnd = new Date(Date.UTC(month.year, month.month, 0));

  for (const subscription of subscriptions) {
    if (subscription.nextChargeDate < monthStart || subscription.nextChargeDate > monthEnd) continue;

    await chargeSubscription(subscription, month, tx);

    const nextDate = addMonthsToDate(subscription.nextChargeDate, intervalMonthsFor(subscription));
    const reachedEnd = subscription.endDate && nextDate > subscription.endDate;
    await tx.subscription.update({
      where: { id: subscription.id },
      data: { nextChargeDate: nextDate, status: reachedEnd ? 'completed' : 'active' },
    });
  }
}

async function createSubscription(userId, payload) {
  const month = await monthsService.getMonthOrThrow(userId, payload.monthId);
  await assertCategoryIsValid(userId, payload.categoryId);

  if (payload.paymentMethod === 'credit') {
    const cardsService = require('../cards/cards.service');
    const card = await cardsService.getOwnedCardOrThrow(userId, payload.cardId);
    if (!card.active) {
      throw new AppError('Este cartão está desativado e não aceita novas cobranças.', 409, 'CARD_INACTIVE');
    }
  }

  return prisma.$transaction(async (tx) => {
    const subscription = await tx.subscription.create({
      data: {
        userId,
        description: payload.description,
        categoryId: payload.categoryId,
        value: payload.value,
        paymentMethod: payload.paymentMethod,
        cardId: payload.cardId ?? null,
        periodicity: payload.periodicity,
        customIntervalMonths: payload.periodicity === 'custom' ? payload.customIntervalMonths : null,
        nextChargeDate: payload.nextChargeDate,
        endDate: payload.endDate ?? null,
        status: 'active',
      },
    });

    // Se a primeira cobrança já cai dentro do mês corrente (o caso comum:
    // "quero começar a assinatura agora"), cobra imediatamente — igual
    // debts/cardPurchases criam a primeira parcela na hora, em vez de
    // esperar o próximo fechamento de mês.
    await processSubscriptionsForMonth(userId, month, tx);

    return subscription;
  }).then(async (subscription) => {
    await recordAuditLog(userId, 'subscription', subscription.id, 'create', { newValue: subscription });
    return subscription;
  });
}

async function updateSubscription(userId, subscriptionId, payload) {
  const subscription = await getOwnedSubscriptionOrThrow(userId, subscriptionId);
  if (payload.categoryId) {
    await assertCategoryIsValid(userId, payload.categoryId);
  }
  const willBeCredit = (payload.paymentMethod ?? subscription.paymentMethod) === 'credit';
  if (willBeCredit && payload.cardId) {
    const cardsService = require('../cards/cards.service');
    const card = await cardsService.getOwnedCardOrThrow(userId, payload.cardId);
    if (!card.active) {
      throw new AppError('Este cartão está desativado e não aceita novas cobranças.', 409, 'CARD_INACTIVE');
    }
  }

  const updated = await prisma.subscription.update({
    where: { id: subscriptionId },
    data: {
      ...(payload.description && { description: payload.description }),
      ...(payload.value !== undefined && { value: payload.value }),
      ...(payload.categoryId && { categoryId: payload.categoryId }),
      ...(payload.paymentMethod && { paymentMethod: payload.paymentMethod }),
      ...(payload.cardId !== undefined && { cardId: payload.cardId }),
      ...(payload.periodicity && { periodicity: payload.periodicity }),
      ...(payload.customIntervalMonths !== undefined && { customIntervalMonths: payload.customIntervalMonths }),
      ...(payload.endDate !== undefined && { endDate: payload.endDate }),
    },
    include: { category: true },
  });
  await recordAuditLog(userId, 'subscription', subscriptionId, 'update', { oldValue: subscription, newValue: updated });
  return updated;
}

/**
 * Pausar difere de cancelar: uma assinatura pausada continua existindo com
 * o mesmo nextChargeDate (retomar continua exatamente de onde parou), só
 * não gera cobrança nenhuma enquanto durar. Cancelar é definitivo.
 */
async function pauseSubscription(userId, subscriptionId) {
  const subscription = await getOwnedSubscriptionOrThrow(userId, subscriptionId);
  if (subscription.status !== 'active') {
    throw new AppError('Só é possível pausar uma assinatura ativa.', 409, 'SUBSCRIPTION_NOT_ACTIVE');
  }
  const updated = await prisma.subscription.update({ where: { id: subscriptionId }, data: { status: 'paused' } });
  await recordAuditLog(userId, 'subscription', subscriptionId, 'update', { oldValue: subscription, newValue: updated });
  return updated;
}

async function resumeSubscription(userId, subscriptionId) {
  const subscription = await getOwnedSubscriptionOrThrow(userId, subscriptionId);
  if (subscription.status !== 'paused') {
    throw new AppError('Só é possível retomar uma assinatura pausada.', 409, 'SUBSCRIPTION_NOT_PAUSED');
  }
  const updated = await prisma.subscription.update({ where: { id: subscriptionId }, data: { status: 'active' } });
  await recordAuditLog(userId, 'subscription', subscriptionId, 'update', { oldValue: subscription, newValue: updated });
  return updated;
}

async function cancelSubscription(userId, subscriptionId) {
  const subscription = await getOwnedSubscriptionOrThrow(userId, subscriptionId);
  if (subscription.status === 'cancelled') {
    throw new AppError('Esta assinatura já está cancelada.', 409, 'SUBSCRIPTION_ALREADY_CANCELLED');
  }
  const updated = await prisma.subscription.update({ where: { id: subscriptionId }, data: { status: 'cancelled' } });
  await recordAuditLog(userId, 'subscription', subscriptionId, 'delete', { oldValue: subscription });
  return updated;
}

module.exports = {
  listSubscriptions,
  createSubscription,
  updateSubscription,
  pauseSubscription,
  resumeSubscription,
  cancelSubscription,
  processSubscriptionsForMonth,
  intervalMonthsFor,
  addMonthsToDate,
};
