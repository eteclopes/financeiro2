const prisma = require('../../config/prisma');
const AppError = require('../../utils/AppError');
const monthsService = require('../months/months.service');
const expensesService = require('../expenses/expenses.service');
const cardsService = require('./cards.service');
const { addMonths } = require('../../utils/monthMath');
const { recordAuditLog } = require('../auditLog/auditLog.service');
const { round2 } = require('../../utils/math');

function clampDay(year, month, day) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 1, Math.min(day, lastDay)));
}

/**
 * Decide em qual fatura uma compra cai: antes (ou no) dia de fechamento vai
 * para a fatura do mês corrente da compra; depois, vai para a do mês
 * seguinte. Esta é a regra textual do projeto ("compra dia 10, fechamento
 * dia 20 -> fatura atual; compra dia 25 -> próxima fatura").
 */
function firstInvoiceReference(purchaseDate, closingDay) {
  const day = purchaseDate.getUTCDate();
  const month = purchaseDate.getUTCMonth() + 1;
  const year = purchaseDate.getUTCFullYear();
  if (day <= closingDay) return { month, year };
  return addMonths(month, year, 1);
}

async function getOrCreateInvoice(card, refMonth, refYear, client = prisma) {
  const existing = await client.cardInvoice.findUnique({
    where: { cardId_referenceMonth_referenceYear: { cardId: card.id, referenceMonth: refMonth, referenceYear: refYear } },
  });
  if (existing) return existing;

  const month = await monthsService.getOrCreateMonth(card.userId, refMonth, refYear, client);

  return client.cardInvoice.create({
    data: {
      cardId: card.id,
      monthId: month.id,
      referenceMonth: refMonth,
      referenceYear: refYear,
      closingDate: clampDay(refYear, refMonth, card.closingDay),
      // Simplificação documentada: vencimento calculado dentro do mesmo mês
      // de referência da fatura. Cartões cujo dia de vencimento é menor que
      // o de fechamento (vencimento "no mês seguinte" ao fechamento) exigem
      // ajuste fino que fica registrado como item da auditoria final.
      dueDate: clampDay(refYear, refMonth, card.dueDay),
      totalValue: 0,
      status: 'open',
    },
  });
}

async function createCardPurchase(userId, payload) {
  const card = await cardsService.getOwnedCardOrThrow(userId, payload.cardId);
  if (!card.active) {
    throw new AppError('Este cartão está desativado e não aceita novas compras.', 409, 'CARD_INACTIVE');
  }
  await expensesService.assertCategoryIsValid(userId, payload.categoryId);

  const { installmentsCount, totalValue } = payload;
  const nominal = round2(totalValue / installmentsCount);
  const base = firstInvoiceReference(payload.purchaseDate, card.closingDay);
  const startingInstallment = payload.startingInstallment ?? 1;

  // Registrando uma compra que já está em andamento (ex.: "já estou na
  // parcela 4 de 12", feita antes de começar a usar o app): só resolvemos
  // fatura e criamos parcela a partir da parcela atual em diante — as
  // anteriores já aconteceram fora do app, não recriamos esse histórico.
  // O valor que ainda resta (e por isso o que de fato consome limite do
  // cartão) é só o das parcelas restantes, não a compra inteira.
  const remainingTotalValue = round2(totalValue - nominal * (startingInstallment - 1));

  // Resolve (cria se necessário) todas as faturas/meses envolvidos ANTES da
  // transação principal. getOrCreateInvoice/getOrCreateMonth são idempotentes
  // (chave única em cardId+referenceMonth+referenceYear e em userId+month+year),
  // então repetir essa resolução não duplica nada — apenas a escrita financeira
  // final (compra, parcelas, totais de fatura) precisa ser atômica de verdade.
  const invoices = [];
  for (let i = startingInstallment; i <= installmentsCount; i += 1) {
    const ref = addMonths(base.month, base.year, i - 1);
    invoices.push(await getOrCreateInvoice(card, ref.month, ref.year));
  }

  return prisma.$transaction(async (tx) => {
    // Antes, o limite era checado FORA da transação: duas compras
    // simultâneas no mesmo cartão podiam ler o mesmo usedLimit e passar na
    // checagem juntas, ultrapassando o limite em conjunto (TOCTOU). O lock
    // consultivo por cartão serializa apenas compras do MESMO cartão entre
    // si — não bloqueia nenhuma outra linha/tabela — e é liberado
    // automaticamente ao fim da transação.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${card.id})`;

    const usedLimit = await cardsService.computeUsedLimit(card.id, tx);
    const availableLimit = Number(card.limitValue) - usedLimit;
    if (remainingTotalValue > availableLimit + 0.009) {
      throw new AppError(
        `Limite insuficiente. Disponível: R$ ${availableLimit.toFixed(2)}.`,
        409,
        'INSUFFICIENT_LIMIT'
      );
    }

    const purchase = await tx.cardPurchase.create({
      data: {
        userId,
        cardId: card.id,
        description: payload.description,
        categoryId: payload.categoryId,
        totalValue: remainingTotalValue,
        installmentsCount: installmentsCount - startingInstallment + 1,
        installmentValue: nominal,
        purchaseDate: payload.purchaseDate,
      },
    });

    const expenses = [];
    let accumulated = 0;

    for (let i = startingInstallment; i <= installmentsCount; i += 1) {
      const invoice = invoices[i - startingInstallment];

      // Última parcela absorve o resíduo de arredondamento, igual ao
      // mecanismo usado em dívidas (debts.service.computeInstallmentValue).
      const value = i === installmentsCount ? round2(remainingTotalValue - accumulated) : nominal;
      accumulated = round2(accumulated + value);

      const expense = await tx.expense.create({
        data: {
          userId,
          monthId: invoice.monthId,
          type: 'card',
          description: `${payload.description} (${i}/${installmentsCount})`,
          categoryId: payload.categoryId,
          dueDate: invoice.dueDate,
          value,
          status: 'pending',
          cardInvoiceId: invoice.id,
          cardPurchaseId: purchase.id,
        },
      });

      await tx.cardInvoice.update({
        where: { id: invoice.id },
        data: { totalValue: { increment: value } },
      });

      expenses.push(expense);
    }

    return { purchase, expenses };
  }).then(async (result) => {
    await recordAuditLog(userId, 'cardPurchase', result.purchase.id, 'create', { newValue: result.purchase });
    return result;
  });
}

module.exports = { createCardPurchase, firstInvoiceReference, clampDay, getOrCreateInvoice };
