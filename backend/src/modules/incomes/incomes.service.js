const prisma = require('../../config/prisma');
const AppError = require('../../utils/AppError');
const monthsService = require('../months/months.service');
const { assertSufficientBalance, lockUserBalance, getAvailableBalance } = require('../_shared/balance');
const { recordAuditLog } = require('../auditLog/auditLog.service');
const { round2 } = require('../../utils/math');
const { normalizePaymentMethod, incomeOriginFor } = require('../../utils/paymentMethods');

/**
 * Garante que a data informada pertence ao mesmo mês/ano do registro de
 * "months" selecionado. Sem isso, seria possível lançar uma receita de
 * janeiro dentro do snapshot de março, corrompendo a regra de histórico
 * por mês.
 */
function assertDateMatchesMonth(date, month) {
  const matches = date.getUTCMonth() + 1 === month.month && date.getUTCFullYear() === month.year;
  if (!matches) {
    throw new AppError(
      'A data informada não pertence ao mês selecionado.',
      422,
      'DATE_OUTSIDE_MONTH'
    );
  }
}

async function assertCategoryIsValid(userId, categoryId) {
  const category = await prisma.category.findFirst({
    where: { id: categoryId, type: 'income', OR: [{ userId: null }, { userId }] },
  });
  if (!category) {
    throw new AppError('Categoria de receita inválida.', 422, 'INVALID_CATEGORY');
  }
}

async function listIncomes(userId, monthId) {
  await monthsService.getMonthOrThrow(userId, monthId);
  return prisma.income.findMany({
    where: { userId, monthId },
    include: { category: true },
    orderBy: { incomeDate: 'asc' },
  });
}

async function createIncome(userId, payload) {
  const month = await monthsService.getMonthOrThrow(userId, payload.monthId);
  monthsService.assertMonthIsOpen(month);
  assertDateMatchesMonth(payload.date, month);
  await assertCategoryIsValid(userId, payload.categoryId);

  // pix/transfer/debit produzem o mesmo efeito: viram o canônico `debit`.
  const paymentMethod = normalizePaymentMethod(payload.paymentMethod, { allowCredit: false });
  const baseData = {
    userId,
    monthId: payload.monthId,
    description: payload.description,
    value: payload.value,
    categoryId: payload.categoryId,
    paymentMethod,
    origin: payload.origin ?? incomeOriginFor(paymentMethod),
    incomeDate: payload.date,
    observation: payload.observation,
  };

  if (!payload.recurring) {
    return prisma.income.create({ data: baseData, include: { category: true } });
  }

  // Receita recorrente: cria o template (fonte da geração automática nos
  // próximos meses, na Etapa 15 — Fechamento Mensal) e a primeira instância
  // já vinculada a ele, na mesma transação.
  return prisma.$transaction(async (tx) => {
    const template = await tx.incomeTemplate.create({
      data: {
        userId,
        description: payload.description,
        value: payload.value,
        categoryId: payload.categoryId,
        paymentMethod,
        incomeDay: payload.date.getUTCDate(),
        active: true,
      },
    });

    return tx.income.create({
      data: { ...baseData, templateId: template.id },
      include: { category: true, template: true },
    });
  });
}

async function getOwnedIncomeOrThrow(userId, incomeId, client = prisma) {
  const income = await client.income.findFirst({
    where: { id: incomeId, userId },
    include: { month: true },
  });
  if (!income) {
    throw new AppError('Receita não encontrada.', 404, 'INCOME_NOT_FOUND');
  }
  return income;
}

/**
 * Edição de receita com ESCOPO EXPLÍCITO.
 *
 * Antes só existia "editar este lançamento", e não havia nenhuma rota para
 * alterar o template da recorrência. O usuário corrigia "Salário 5000 ->
 * 6000" e, no mês seguinte, o fechamento regenerava 5000 — sem nenhum
 * aviso de que a correção valia só para aquele mês.
 *
 * scope:
 *   'single' (padrão) -> altera apenas este lançamento
 *   'future'          -> altera este e passa a valer nos próximos meses
 *                        (atualiza o template). Meses FECHADOS e
 *                        lançamentos já gerados no passado nunca são
 *                        reescritos.
 */
async function updateIncome(userId, incomeId, payload, { scope = 'single' } = {}) {
  const initial = await getOwnedIncomeOrThrow(userId, incomeId);
  monthsService.assertMonthIsOpen(initial.month);

  const initialEffectiveDate = payload.date ?? initial.incomeDate;
  assertDateMatchesMonth(initialEffectiveDate, initial.month);
  if (payload.categoryId) await assertCategoryIsValid(userId, payload.categoryId);

  if (scope === 'future' && !initial.templateId) {
    throw new AppError(
      'Esta receita não é recorrente, portanto não existem próximos lançamentos para alterar.',
      422,
      'INCOME_NOT_RECURRING'
    );
  }

  const paymentMethod = payload.paymentMethod
    ? normalizePaymentMethod(payload.paymentMethod, { allowCredit: false })
    : undefined;

  return prisma.$transaction(async (tx) => {
    await lockUserBalance(tx, userId);
    const income = await getOwnedIncomeOrThrow(userId, incomeId, tx);
    monthsService.assertMonthIsOpen(income.month);

    const effectiveDate = payload.date ?? income.incomeDate;
    const effectiveValue = payload.value !== undefined ? Number(payload.value) : Number(income.value);
    assertDateMatchesMonth(effectiveDate, income.month);

    // Toda receita salva impacta o saldo imediatamente (decisão de produto).
    // A data é referência de competência, não de liberação do dinheiro.
    // Reduzir uma receita não pode deixar o caixa negativo por acidente —
    // para correções que exigem isso, ver `deleteIncome`/`allowNegativeBalance`.
    const reduction = round2(Number(income.value) - effectiveValue);
    if (reduction > 0) await assertSufficientBalance(userId, reduction, tx);

    const updated = await tx.income.update({
      where: { id: incomeId },
      data: {
        ...(payload.description && { description: payload.description }),
        ...(payload.value !== undefined && { value: payload.value }),
        ...(payload.categoryId && { categoryId: payload.categoryId }),
        ...(paymentMethod && { paymentMethod, origin: incomeOriginFor(paymentMethod) }),
        ...(payload.origin && { origin: payload.origin }),
        ...(payload.date && { incomeDate: payload.date }),
        ...(payload.observation !== undefined && { observation: payload.observation }),
      },
      include: { category: true },
    });

    let template = null;
    if (scope === 'future') {
      template = await tx.incomeTemplate.update({
        where: { id: income.templateId },
        data: {
          ...(payload.description && { description: payload.description }),
          ...(payload.value !== undefined && { value: payload.value }),
          ...(payload.categoryId && { categoryId: payload.categoryId }),
          ...(paymentMethod && { paymentMethod }),
          ...(payload.date && { incomeDay: payload.date.getUTCDate() }),
        },
      });

      // Ocorrências JÁ GERADAS em meses futuros ainda abertos também
      // acompanham a nova regra; meses fechados ficam intactos.
      await tx.income.updateMany({
        where: {
          userId,
          templateId: income.templateId,
          id: { not: incomeId },
          month: { status: 'open' },
          OR: [
            { month: { year: { gt: income.month.year } } },
            { month: { year: income.month.year, month: { gt: income.month.month } } },
          ],
        },
        data: {
          ...(payload.description && { description: payload.description }),
          ...(payload.value !== undefined && { value: payload.value }),
          ...(payload.categoryId && { categoryId: payload.categoryId }),
          ...(paymentMethod && { paymentMethod, origin: incomeOriginFor(paymentMethod) }),
        },
      });
    }

    return { income: updated, template, scope };
  });
}

/** Encerra a recorrência sem apagar nenhum lançamento já existente. */
async function endRecurrence(userId, incomeId) {
  const income = await getOwnedIncomeOrThrow(userId, incomeId);
  if (!income.templateId) {
    throw new AppError('Esta receita não é recorrente.', 422, 'INCOME_NOT_RECURRING');
  }
  const template = await prisma.incomeTemplate.updateMany({
    where: { id: income.templateId, userId },
    data: { active: false },
  });
  if (template.count === 0) {
    throw new AppError('Receita recorrente não encontrada.', 404, 'INCOME_TEMPLATE_NOT_FOUND');
  }
  await recordAuditLog(userId, 'incomeTemplate', income.templateId, 'end_recurrence');
  return { ended: true };
}

/**
 * Exclusão de receita — inclusive para CORRIGIR um erro de digitação.
 *
 * Antes, excluir exigia saldo suficiente para cobrir o valor inteiro. Quem
 * lançasse R$ 10.000 por engano e já tivesse gastado parte do dinheiro
 * ficava com o erro preso para sempre: a validação bloqueava a única forma
 * de corrigir.
 *
 * Agora a exclusão é sempre possível, mas nunca silenciosa:
 *  - se o saldo cobre, remove normalmente;
 *  - se NÃO cobre, exige confirmação explícita (`allowNegativeBalance`),
 *    devolve o impacto calculado e registra a correção na auditoria.
 * O histórico financeiro não é apagado às escondidas — fica o registro de
 * quem removeu, quando e qual saldo resultou.
 */
async function deleteIncome(userId, incomeId, { allowNegativeBalance = false } = {}) {
  const initial = await getOwnedIncomeOrThrow(userId, incomeId);
  monthsService.assertMonthIsOpen(initial.month);

  const result = await prisma.$transaction(async (tx) => {
    await lockUserBalance(tx, userId);
    const income = await getOwnedIncomeOrThrow(userId, incomeId, tx);
    monthsService.assertMonthIsOpen(income.month);

    const available = await getAvailableBalance(userId, tx);
    const value = Number(income.value);
    const resultingBalance = round2(available - value);

    if (resultingBalance < 0 && !allowNegativeBalance) {
      throw new AppError(
        `Excluir esta receita deixaria o saldo disponível em R$ ${resultingBalance.toFixed(2)}, porque parte do dinheiro já foi utilizada. Confirme para prosseguir com a correção.`,
        409,
        'INCOME_DELETE_NEEDS_CONFIRMATION',
        {
          availableBalance: available,
          incomeValue: round2(value),
          resultingBalance,
          requiresConfirmation: true,
        }
      );
    }

    const deleted = await tx.income.delete({ where: { id: incomeId } });
    return { deleted, resultingBalance, wentNegative: resultingBalance < 0 };
  });

  await recordAuditLog(userId, 'income', incomeId, 'delete', {
    newValue: { status: result.wentNegative ? 'negative_balance_correction' : 'deleted' },
  });
  return result;
}

async function deactivateRecurringTemplate(userId, templateId) {
  const template = await prisma.incomeTemplate.findFirst({ where: { id: templateId, userId } });
  if (!template) {
    throw new AppError('Receita recorrente não encontrada.', 404, 'INCOME_TEMPLATE_NOT_FOUND');
  }
  return prisma.incomeTemplate.update({ where: { id: templateId }, data: { active: false } });
}

module.exports = {
  listIncomes,
  createIncome,
  updateIncome,
  endRecurrence,
  deleteIncome,
  deactivateRecurringTemplate,
};
