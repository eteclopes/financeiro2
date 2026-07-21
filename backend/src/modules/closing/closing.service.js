const prisma = require('../../config/prisma');
const AppError = require('../../utils/AppError');
const monthsService = require('../months/months.service');
const expensesService = require('../expenses/expenses.service');
const debtsService = require('../debts/debts.service');
const { addMonths } = require('../../utils/monthMath');
const { recordAuditLog } = require('../auditLog/auditLog.service');

/**
 * Resumo exibido antes do fechamento, para confirmação do usuário.
 * Não fecha nada — apenas leitura.
 */
async function getClosingPreview(userId, monthId) {
  const month = await monthsService.getMonthOrThrow(userId, monthId);

  const [pendingExpenses, pendingExpensesSum, openInvoices, activeGoalsCount, activeIncomeTemplates, activeFixedTemplates, activeDebts] =
    await Promise.all([
      prisma.expense.count({
        where: { userId, monthId, deletedAt: null, status: { in: ['pending', 'partial', 'late'] } },
      }),
      prisma.expense.aggregate({
        where: { userId, monthId, deletedAt: null, status: { in: ['pending', 'partial', 'late'] } },
        _sum: { value: true },
      }),
      prisma.cardInvoice.count({ where: { monthId, status: { not: 'paid' } } }),
      prisma.goal.count({ where: { userId, status: 'active' } }),
      prisma.incomeTemplate.count({ where: { userId, active: true } }),
      prisma.fixedExpenseTemplate.count({ where: { userId, active: true } }),
      prisma.debt.count({ where: { userId, status: 'active' } }),
    ]);

  return {
    month,
    pendingExpensesCount: pendingExpenses,
    pendingExpensesTotal: Number(pendingExpensesSum._sum.value ?? 0),
    openInvoicesCount: openInvoices,
    activeGoalsCount,
    willGenerateNextMonth: {
      recurringIncomes: activeIncomeTemplates,
      fixedExpenses: activeFixedTemplates,
      debtInstallments: activeDebts,
    },
  };
}

async function closeMonth(userId, monthId) {
  return prisma.$transaction(async (tx) => {
    // SELECT ... FOR UPDATE trava a linha do mês até o fim da transação.
    // Se duas requisições de fechamento chegarem juntas (duplo clique, retry
    // de rede), a segunda espera a primeira terminar e então enxerga
    // status='closed', falhando de forma segura em vez de duplicar geração
    // de receitas/despesas/parcelas — este é o ponto de maior risco de bug
    // de duplicação do sistema inteiro (ver arquitetura-etapas-1-2.md §14).
    const locked = await tx.$queryRaw`SELECT id, status, month, year FROM months WHERE id = ${monthId} AND user_id = ${userId} FOR UPDATE`;
    const raw = locked[0];
    if (!raw) throw new AppError("Mês não encontrado.", 404, "MONTH_NOT_FOUND");
    const current = { id: raw.id, status: raw.status, month: Number(raw.month), year: Number(raw.year) };

    if (current.status === 'closed') {
      throw new AppError('Este mês já foi encerrado.', 409, 'MONTH_ALREADY_CLOSED');
    }

    await tx.month.update({ where: { id: monthId }, data: { status: 'closed', closedAt: new Date() } });

    const next = addMonths(current.month, current.year, 1);
    const nextMonth = await monthsService.getOrCreateMonth(userId, next.month, next.year, tx);

    const generated = { incomes: 0, fixedExpenses: 0, debtInstallments: 0 };

    // ---- Receitas recorrentes ----
    const incomeTemplates = await tx.incomeTemplate.findMany({ where: { userId, active: true } });
    for (const template of incomeTemplates) {
      const alreadyGenerated = await tx.income.findFirst({
        where: { templateId: template.id, monthId: nextMonth.id },
      });
      if (alreadyGenerated) continue; // idempotência extra, além do lock acima

      await tx.income.create({
        data: {
          userId,
          monthId: nextMonth.id,
          templateId: template.id,
          description: template.description,
          value: template.value,
          categoryId: template.categoryId,
          paymentMethod: template.paymentMethod,
          origin: 'digital',
          incomeDate: new Date(Date.UTC(next.year, next.month - 1, 1)),
        },
      });
      generated.incomes += 1;
    }

    // ---- Despesas fixas recorrentes ----
    const fixedTemplates = await tx.fixedExpenseTemplate.findMany({ where: { userId, active: true } });
    for (const template of fixedTemplates) {
      const alreadyGenerated = await tx.expense.findFirst({
        where: { fixedTemplateId: template.id, monthId: nextMonth.id },
      });
      if (alreadyGenerated) continue;

      const dueDate = expensesService.dueDateFromDay(nextMonth, template.dueDay);

      // Vinculada a cartão: a próxima instância nasce direto na fatura
      // correspondente (mesma regra de "em qual fatura cai" das compras no
      // cartão), como despesa tipo 'card' — não desconta do saldo até a
      // fatura ser paga. Um cartão desativado depois de a despesa fixa já
      // estar configurada não bloqueia o fechamento (diferente da criação):
      // travar o fechamento do mês inteiro por causa de um cartão
      // desativado seria pior que simplesmente lançar a despesa mesmo
      // assim — o usuário já foi avisado ao tentar editar/usar o cartão.
      if (template.paymentMethod === 'credit' && template.cardId) {
        const card = await tx.card.findUnique({ where: { id: template.cardId } });
        if (card) {
          const cardPurchasesService = require('../cards/cardPurchases.service');
          const ref = cardPurchasesService.firstInvoiceReference(dueDate, card.closingDay);
          const invoice = await cardPurchasesService.getOrCreateInvoice(card, ref.month, ref.year, tx);

          await tx.expense.create({
            data: {
              userId,
              monthId: invoice.monthId,
              type: 'card',
              description: template.description,
              categoryId: template.categoryId,
              dueDate,
              value: template.value,
              status: 'pending',
              fixedTemplateId: template.id,
              cardInvoiceId: invoice.id,
              paymentMethod: template.paymentMethod,
            },
          });
          await tx.cardInvoice.update({ where: { id: invoice.id }, data: { totalValue: { increment: Number(template.value) } } });
          generated.fixedExpenses += 1;
          continue;
        }
      }

      await tx.expense.create({
        data: {
          userId,
          monthId: nextMonth.id,
          type: 'fixed',
          description: template.description,
          categoryId: template.categoryId,
          dueDate,
          value: template.value,
          status: 'pending',
          fixedTemplateId: template.id,
          paymentMethod: template.paymentMethod,
        },
      });
      generated.fixedExpenses += 1;
    }

    // ---- Próxima parcela de cada dívida ativa ----
    // Compras parceladas no cartão NÃO entram aqui: todas as parcelas já
    // foram geradas de uma vez no momento da compra (ver cardPurchases.service.js).
    const activeDebts = await tx.debt.findMany({ where: { userId, status: 'active' } });
    for (const debt of activeDebts) {
      const alreadyGenerated = await tx.expense.findFirst({ where: { debtId: debt.id, monthId: nextMonth.id } });
      if (alreadyGenerated) continue;

      const created = await debtsService.generateNextInstallment(debt, nextMonth, tx);
      if (created) generated.debtInstallments += 1;
    }

    // ---- Assinaturas com cobrança devida no mês recém-aberto ----
    // Ao contrário de despesa fixa (sempre mensal), assinatura pode ser
    // anual/customizada — a maioria dos meses não gera cobrança nenhuma
    // pra maioria das assinaturas; só quando nextChargeDate cai dentro do
    // mês que está abrindo.
    const subscriptionsService = require('../subscriptions/subscriptions.service');
    await subscriptionsService.processSubscriptionsForMonth(userId, nextMonth, tx);

    // ---- O que NÃO precisa de ação aqui ----
    // Pendências do mês que está fechando (despesas não pagas, faturas não
    // pagas) permanecem vinculadas a ele — não são copiadas/duplicadas no
    // próximo mês, apenas continuam aparecendo como "Atrasado" até o
    // usuário pagá-las. Saldo guardado e metas são entidades contínuas, não
    // mensais, e não precisam de nenhum transporte.

    return {
      closedMonth: { id: monthId, month: current.month, year: current.year },
      nextMonth,
      generated,
    };
  }).then(async (result) => {
    await recordAuditLog(userId, 'month', monthId, 'close', { newValue: result.closedMonth });
    return result;
  });
}

module.exports = { getClosingPreview, closeMonth };
