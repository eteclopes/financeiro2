const prisma = require('../../config/prisma');
const AppError = require('../../utils/AppError');

async function assertCategoryIsValid(userId, categoryId, type) {
  const category = await prisma.category.findFirst({
    where: { id: categoryId, type, OR: [{ userId: null }, { userId }] },
  });
  if (!category) {
    throw new AppError(`Categoria de ${type === 'income' ? 'receita' : 'despesa'} inválida.`, 422, 'INVALID_CATEGORY');
  }
  return category;
}

async function listCategories(userId, type) {
  const categories = await prisma.category.findMany({
    where: { type, OR: [{ userId: null }, { userId }] },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
  });
  if (type !== 'expense' || categories.length === 0) return categories;
  const budgets = await prisma.categoryBudget.findMany({
    where: { userId, categoryId: { in: categories.map((category) => category.id) } },
  });
  const byCategory = new Map(budgets.map((budget) => [String(budget.categoryId), budget.monthlyLimit]));
  return categories.map((category) => ({
    ...category,
    monthlyLimit: byCategory.get(String(category.id)) ?? null,
  }));
}

async function createCategory(userId, { name, type }) {
  const existing = await prisma.category.findFirst({
    where: { type, name, OR: [{ userId: null }, { userId }] },
  });
  if (existing) throw new AppError('Já existe uma categoria com este nome.', 409, 'CATEGORY_ALREADY_EXISTS');
  return prisma.category.create({ data: { userId, name, type, isDefault: false } });
}

async function renameCategory(userId, categoryId, name) {
  const category = await prisma.category.findFirst({ where: { id: categoryId, userId } });
  if (!category) throw new AppError('Categoria não encontrada.', 404, 'CATEGORY_NOT_FOUND');
  if (name === category.name) return category;
  const duplicate = await prisma.category.findFirst({
    where: { type: category.type, name, OR: [{ userId: null }, { userId }] },
  });
  if (duplicate) throw new AppError('Já existe uma categoria com este nome.', 409, 'CATEGORY_ALREADY_EXISTS');
  return prisma.category.update({ where: { id: categoryId }, data: { name } });
}

async function deleteCategory(userId, categoryId) {
  const category = await prisma.category.findFirst({ where: { id: categoryId, userId } });
  if (!category) throw new AppError('Categoria não encontrada.', 404, 'CATEGORY_NOT_FOUND');
  const inUse = await prisma.$transaction([
    prisma.income.count({ where: { categoryId } }),
    prisma.expense.count({ where: { categoryId } }),
  ]);
  if (inUse.some((count) => count > 0)) {
    throw new AppError('Esta categoria já foi usada em lançamentos e não pode ser excluída.', 409, 'CATEGORY_IN_USE');
  }
  await prisma.category.delete({ where: { id: categoryId } });
}

/** Orçamento é uma preferência do usuário; nunca duplica a categoria. */
async function updateCategoryLimit(userId, categoryId, monthlyLimit) {
  const category = await prisma.category.findFirst({
    where: { id: categoryId, type: 'expense', OR: [{ userId: null }, { userId }] },
  });
  if (!category) throw new AppError('Categoria não encontrada.', 404, 'CATEGORY_NOT_FOUND');

  if (monthlyLimit == null) {
    await prisma.categoryBudget.deleteMany({ where: { userId, categoryId } });
    return { ...category, monthlyLimit: null };
  }
  const budget = await prisma.categoryBudget.upsert({
    where: { userId_categoryId: { userId, categoryId } },
    create: { userId, categoryId, monthlyLimit },
    update: { monthlyLimit },
  });
  return { ...category, monthlyLimit: budget.monthlyLimit };
}

async function getBudgetStatus(userId, monthId) {
  const budgets = await prisma.categoryBudget.findMany({
    where: { userId, category: { type: 'expense' } },
    include: { category: true },
    orderBy: { category: { name: 'asc' } },
  });
  if (budgets.length === 0) return [];
  const categoryIds = budgets.map((budget) => budget.categoryId);
  const spentRows = await prisma.expense.groupBy({
    by: ['categoryId'],
    where: { userId, monthId, deletedAt: null, status: { not: 'reversed' }, categoryId: { in: categoryIds } },
    _sum: { value: true },
  });
  const spentMap = new Map(spentRows.map((row) => [String(row.categoryId), Number(row._sum.value ?? 0)]));
  return budgets.map((budget) => {
    const spent = spentMap.get(String(budget.categoryId)) ?? 0;
    const limit = Number(budget.monthlyLimit);
    return {
      categoryId: String(budget.categoryId),
      categoryName: budget.category.name,
      monthlyLimit: limit,
      spent,
      remaining: Math.round((limit - spent) * 100) / 100,
      percentUsed: limit > 0 ? Math.round((spent / limit) * 1000) / 10 : 0,
      exceeded: spent > limit,
    };
  });
}

module.exports = {
  assertCategoryIsValid,
  listCategories,
  createCategory,
  renameCategory,
  deleteCategory,
  updateCategoryLimit,
  getBudgetStatus,
};
