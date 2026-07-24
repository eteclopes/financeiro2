const prisma = require('../../config/prisma');
const AppError = require('../../utils/AppError');
const monthsService = require('../months/months.service');
const expensesService = require('../expenses/expenses.service');
const debtsService = require('../debts/debts.service');
const { addMonths } = require('../../utils/monthMath');
const { recordAuditLog } = require('../auditLog/auditLog.service');
const { buildMonthSnapshot, SNAPSHOT_VERSION } = require('../months/monthSnapshot.service');

const CLOSE_TRANSACTION_OPTIONS = {
  maxWait: 10_000,
  timeout: 30_000,
};

function bigintKey(value) {
  return value == null ? null : String(value);
}

async function getGenerationSnapshot(client, userId, nextMonth, next) {
  const [incomeTemplates, fixedTemplates, activeDebts, existingIncomes, existingFixed, existingDebtExpenses] =
    await Promise.all([
      client.incomeTemplate.findMany({ where: { userId, active: true } }),
      client.fixedExpenseTemplate.findMany({ where: { userId, active: true } }),
      client.debt.findMany({ where: { userId, status: 'active' } }),
      client.income.findMany({
        where: { userId, monthId: nextMonth.id, templateId: { not: null } },
        select: { templateId: true },
      }),
      client.expense.findMany({
        where: {
          userId,
          deletedAt: null,
          fixedTemplateId: { not: null },
          competenceMonth: next.month,
          competenceYear: next.year,
        },
        select: { fixedTemplateId: true },
      }),
      client.expense.findMany({
        where: { userId, monthId: nextMonth.id, deletedAt: null, debtId: { not: null } },
        select: { debtId: true },
      }),
    ]);

  const existingIncomeIds = new Set(existingIncomes.map((row) => bigintKey(row.templateId)).filter(Boolean));
  const existingFixedIds = new Set(existingFixed.map((row) => bigintKey(row.fixedTemplateId)).filter(Boolean));
  const existingDebtIds = new Set(existingDebtExpenses.map((row) => bigintKey(row.debtId)).filter(Boolean));

  return {
    incomeTemplates,
    fixedTemplates,
    activeDebts,
    missingIncomeTemplates: incomeTemplates.filter((template) => !existingIncomeIds.has(bigintKey(template.id))),
    missingFixedTemplates: fixedTemplates.filter((template) => !existingFixedIds.has(bigintKey(template.id))),
    missingDebts: activeDebts.filter((debt) => !existingDebtIds.has(bigintKey(debt.id))),
  };
}

/**
 * Resumo exibido antes do fechamento/reparo. Para mês fechado, os números
 * representam somente o que ainda está faltando no mês seguinte.
 */
async function getClosingPreview(userId, monthId) {
  const month = await monthsService.getMonthOrThrow(userId, monthId);
  const next = addMonths(Number(month.month), Number(month.year), 1);
  const nextMonth = await prisma.month.findUnique({
    where: { userId_month_year: { userId, month: next.month, year: next.year } },
  });

  const [pendingExpenses, pendingExpensesSum, openInvoices, activeGoalsCount] = await Promise.all([
    prisma.expense.count({
      where: { userId, monthId, deletedAt: null, status: { in: ['pending', 'partial', 'late'] } },
    }),
    prisma.expense.aggregate({
      where: { userId, monthId, deletedAt: null, status: { in: ['pending', 'partial', 'late'] } },
      _sum: { value: true },
    }),
    prisma.cardInvoice.count({ where: { monthId, card: { userId }, status: { not: 'paid' } } }),
    prisma.goal.count({ where: { userId, status: 'active' } }),
  ]);

  let missingCounts;
  let totalCounts;
  if (nextMonth) {
    const snapshot = await getGenerationSnapshot(prisma, userId, nextMonth, next);
    missingCounts = {
      recurringIncomes: snapshot.missingIncomeTemplates.length,
      fixedExpenses: snapshot.missingFixedTemplates.length,
      debtInstallments: snapshot.missingDebts.length,
    };
    totalCounts = {
      recurringIncomes: snapshot.incomeTemplates.length,
      fixedExpenses: snapshot.fixedTemplates.length,
      debtInstallments: snapshot.activeDebts.length,
    };
  } else {
    const [recurringIncomes, fixedExpenses, debtInstallments] = await Promise.all([
      prisma.incomeTemplate.count({ where: { userId, active: true } }),
      prisma.fixedExpenseTemplate.count({ where: { userId, active: true } }),
      prisma.debt.count({ where: { userId, status: 'active' } }),
    ]);
    missingCounts = { recurringIncomes, fixedExpenses, debtInstallments };
    totalCounts = { ...missingCounts };
  }

  return {
    month,
    repairMode: month.status === 'closed',
    needsRepair: Object.values(missingCounts).some((count) => count > 0),
    pendingExpensesCount: pendingExpenses,
    pendingExpensesTotal: Number(pendingExpensesSum._sum.value ?? 0),
    openInvoicesCount: openInvoices,
    activeGoalsCount,
    willGenerateNextMonth: missingCounts,
    totalActiveTemplates: totalCounts,
  };
}

async function generateNextMonthEntries(tx, userId, current, nextMonth, next) {
  const snapshot = await getGenerationSnapshot(tx, userId, nextMonth, next);
  const generated = { incomes: 0, fixedExpenses: 0, debtInstallments: 0 };

  if (snapshot.missingIncomeTemplates.length > 0) {
    const result = await tx.income.createMany({
      data: snapshot.missingIncomeTemplates.map((template) => ({
        userId,
        monthId: nextMonth.id,
        templateId: template.id,
        description: template.description,
        value: template.value,
        categoryId: template.categoryId,
        paymentMethod: template.paymentMethod,
        origin: template.paymentMethod === 'cash' ? 'physical' : 'digital',
        incomeDate: expensesService.dueDateFromDay(nextMonth, template.incomeDay ?? 1),
      })),
    });
    generated.incomes = result.count;
  }

  const cardTemplateIds = snapshot.missingFixedTemplates
    .filter((template) => template.paymentMethod === 'credit')
    .map((template) => template.cardId)
    .filter(Boolean);
  const cards = cardTemplateIds.length > 0
    ? await tx.card.findMany({ where: { id: { in: cardTemplateIds }, userId } })
    : [];
  const cardsById = new Map(cards.map((card) => [bigintKey(card.id), card]));
  const commonFixed = [];
  const cardPurchasesService = require('../cards/cardPurchases.service');

  for (const template of snapshot.missingFixedTemplates) {
    const dueDate = expensesService.dueDateFromDay(nextMonth, template.dueDay);
    if (template.paymentMethod === 'credit') {
      const card = template.cardId ? cardsById.get(bigintKey(template.cardId)) : null;
      if (!card || !card.active) {
        throw new AppError(
          `O cartão da despesa fixa "${template.description}" está indisponível. Edite a despesa antes de encerrar ou reparar o mês.`,
          409,
          'FIXED_EXPENSE_CARD_INACTIVE'
        );
      }
      await cardPurchasesService.createFixedCardCharge({
        userId,
        card,
        template,
        month: nextMonth,
        dueDate,
        client: tx,
      });
      generated.fixedExpenses += 1;
    } else {
      commonFixed.push({
        userId,
        monthId: nextMonth.id,
        type: 'fixed',
        description: template.description,
        categoryId: template.categoryId,
        dueDate,
        competenceMonth: next.month,
        competenceYear: next.year,
        value: template.value,
        status: 'pending',
        fixedTemplateId: template.id,
        paymentMethod: template.paymentMethod,
      });
    }
  }

  if (commonFixed.length > 0) {
    const result = await tx.expense.createMany({ data: commonFixed, skipDuplicates: true });
    generated.fixedExpenses += result.count;
  }

  if (snapshot.missingDebts.length > 0) {
    const debtIds = snapshot.missingDebts.map((debt) => debt.id);
    const counts = await tx.expense.groupBy({
      by: ['debtId'],
      where: { debtId: { in: debtIds }, deletedAt: null },
      _count: { _all: true },
    });
    const countByDebt = new Map(counts.map((row) => [bigintKey(row.debtId), row._count._all]));

    for (const debt of snapshot.missingDebts) {
      const created = await debtsService.generateNextInstallment(debt, nextMonth, tx, {
        installmentsGenerated: countByDebt.get(bigintKey(debt.id)) ?? 0,
      });
      if (created) generated.debtInstallments += 1;
    }
  }

  return { generated, expected: {
    incomes: snapshot.incomeTemplates.length,
    fixedExpenses: snapshot.fixedTemplates.length,
    debtInstallments: snapshot.activeDebts.length,
  } };
}

async function closeMonth(userId, monthId) {
  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      // Um lock por usuário serializa fechamento, reparo e retries. O lock da
      // linha do mês protege também contra duas chamadas do mesmo mês.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${userId})`;
      const locked = await tx.$queryRaw`
        SELECT id, status, month, year, closed_at, created_at, financial_snapshot, snapshot_version
        FROM months
        WHERE id = ${monthId} AND user_id = ${userId}
        FOR UPDATE
      `;
      const raw = locked[0];
      if (!raw) throw new AppError('Mês não encontrado.', 404, 'MONTH_NOT_FOUND');

      const current = {
        id: raw.id,
        status: raw.status,
        month: Number(raw.month),
        year: Number(raw.year),
        closedAt: raw.closed_at,
        createdAt: raw.created_at,
        financialSnapshot: raw.financial_snapshot,
        snapshotVersion: raw.snapshot_version,
      };
      const repaired = current.status === 'closed';
      const hasSnapshot = current.financialSnapshot && Number(current.snapshotVersion) === SNAPSHOT_VERSION;
      const snapshot = hasSnapshot
        ? current.financialSnapshot
        : await buildMonthSnapshot(userId, current, tx, repaired
          ? { recordedBefore: current.closedAt || current.createdAt || new Date(), reconstructed: true }
          : {});

      const next = addMonths(current.month, current.year, 1);
      const nextMonth = await monthsService.getOrCreateMonth(userId, next.month, next.year, tx);
      const generation = await generateNextMonthEntries(tx, userId, current, nextMonth, next);

      // O status e o retrato financeiro só são persistidos DEPOIS que todas
      // as recorrências foram geradas. Se a transação falhar, nada fica pela
      // metade e o mês continua podendo ser tentado/reparado com segurança.
      if (!repaired) {
        await tx.month.update({
          where: { id: monthId },
          data: {
            status: 'closed',
            closedAt: new Date(),
            financialSnapshot: snapshot,
            snapshotVersion: SNAPSHOT_VERSION,
          },
        });
      } else if (!hasSnapshot) {
        await tx.month.update({
          where: { id: monthId },
          data: { financialSnapshot: snapshot, snapshotVersion: SNAPSHOT_VERSION },
        });
      }

      return {
        closedMonth: { id: monthId, month: current.month, year: current.year },
        nextMonth,
        repaired,
        generated: generation.generated,
        expected: generation.expected,
      };
    }, CLOSE_TRANSACTION_OPTIONS);
  } catch (error) {
    if (error?.code === 'P2028') {
      throw new AppError(
        'O fechamento demorou além do limite seguro e foi cancelado. Nenhuma geração parcial deve ser considerada concluída; tente novamente.',
        503,
        'MONTH_CLOSE_TIMEOUT'
      );
    }
    throw error;
  }

  await recordAuditLog(
    userId,
    'month',
    monthId,
    result.repaired ? 'repair_close' : 'close',
    { newValue: result.closedMonth }
  );
  return result;
}

module.exports = {
  getClosingPreview,
  closeMonth,
  generateNextMonthEntries,
  CLOSE_TRANSACTION_OPTIONS,
};
