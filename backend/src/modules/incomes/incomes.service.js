const prisma = require('../../config/prisma');
const AppError = require('../../utils/AppError');
const monthsService = require('../months/months.service');

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

  const baseData = {
    userId,
    monthId: payload.monthId,
    description: payload.description,
    value: payload.value,
    categoryId: payload.categoryId,
    paymentMethod: payload.paymentMethod,
    origin: payload.origin,
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
        paymentMethod: payload.paymentMethod,
        active: true,
      },
    });

    return tx.income.create({
      data: { ...baseData, templateId: template.id },
      include: { category: true, template: true },
    });
  });
}

async function getOwnedIncomeOrThrow(userId, incomeId) {
  const income = await prisma.income.findFirst({
    where: { id: incomeId, userId },
    include: { month: true },
  });
  if (!income) {
    throw new AppError('Receita não encontrada.', 404, 'INCOME_NOT_FOUND');
  }
  return income;
}

async function updateIncome(userId, incomeId, payload) {
  const income = await getOwnedIncomeOrThrow(userId, incomeId);
  monthsService.assertMonthIsOpen(income.month);

  const effectiveDate = payload.date ?? income.incomeDate;
  assertDateMatchesMonth(effectiveDate, income.month);

  if (payload.categoryId) {
    await assertCategoryIsValid(userId, payload.categoryId);
  }

  // Importante: isto altera SOMENTE esta instância. O template (se existir)
  // nunca é tocado aqui — editar o valor do mês corrente não pode mudar
  // o que será gerado para meses futuros nem reescrever meses passados.
  return prisma.income.update({
    where: { id: incomeId },
    data: {
      ...(payload.description && { description: payload.description }),
      ...(payload.value !== undefined && { value: payload.value }),
      ...(payload.categoryId && { categoryId: payload.categoryId }),
      ...(payload.paymentMethod && { paymentMethod: payload.paymentMethod }),
      ...(payload.origin && { origin: payload.origin }),
      ...(payload.date && { incomeDate: payload.date }),
      ...(payload.observation !== undefined && { observation: payload.observation }),
    },
    include: { category: true },
  });
}

async function deleteIncome(userId, incomeId) {
  const income = await getOwnedIncomeOrThrow(userId, incomeId);
  monthsService.assertMonthIsOpen(income.month);
  // Seguro excluir fisicamente aqui: só é possível chegar a este ponto se
  // o mês ainda está aberto — uma vez fechado, assertMonthIsOpen bloqueia
  // qualquer exclusão, preservando o histórico imutável.
  await prisma.income.delete({ where: { id: incomeId } });
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
  deleteIncome,
  deactivateRecurringTemplate,
};
