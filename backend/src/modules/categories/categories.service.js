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
  return prisma.category.findMany({
    where: {
      type,
      OR: [{ userId: null }, { userId }],
    },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
  });
}

async function createCategory(userId, { name, type }) {
  const existing = await prisma.category.findFirst({
    where: { type, name, OR: [{ userId: null }, { userId }] },
  });
  if (existing) {
    throw new AppError('Já existe uma categoria com este nome.', 409, 'CATEGORY_ALREADY_EXISTS');
  }

  return prisma.category.create({ data: { userId, name, type, isDefault: false } });
}

// Renomeia uma categoria PRÓPRIA do usuário. Segue o mesmo padrão de posse
// de deleteCategory: a busca já filtra por userId (não por OR com null),
// então uma categoria padrão do sistema (userId null) nunca é encontrada
// aqui de propósito — usuário não pode renomear categoria padrão, só as
// próprias. Isso é idêntico ao comentário existente em deleteCategory.
async function renameCategory(userId, categoryId, name) {
  const category = await prisma.category.findFirst({ where: { id: categoryId, userId } });
  if (!category) {
    throw new AppError('Categoria não encontrada.', 404, 'CATEGORY_NOT_FOUND');
  }

  if (name === category.name) return category;

  // Mesma checagem de duplicidade do createCategory (nome único por
  // usuário+tipo, incluindo categorias padrão compartilhadas) — sem isso o
  // rename poderia colidir com o @@unique([userId, name, type]) do schema
  // e vazar um erro 500 de constraint em vez de uma mensagem amigável.
  const duplicate = await prisma.category.findFirst({
    where: { type: category.type, name, OR: [{ userId: null }, { userId }] },
  });
  if (duplicate) {
    throw new AppError('Já existe uma categoria com este nome.', 409, 'CATEGORY_ALREADY_EXISTS');
  }

  return prisma.category.update({ where: { id: categoryId }, data: { name } });
}

async function deleteCategory(userId, categoryId) {
  const category = await prisma.category.findFirst({ where: { id: categoryId, userId } });
  if (!category) {
    // Categorias padrão (userId null) nunca são encontradas aqui de propósito —
    // usuário não pode excluir categoria do sistema, só as próprias.
    throw new AppError('Categoria não encontrada.', 404, 'CATEGORY_NOT_FOUND');
  }

  // Categoria em uso não pode ser excluída fisicamente — quebraria FK de
  // receitas/despesas já lançadas e o histórico imutável dessas instâncias.
  const inUse = await prisma.$transaction([
    prisma.income.count({ where: { categoryId } }),
    prisma.expense.count({ where: { categoryId } }),
  ]);
  if (inUse.some((count) => count > 0)) {
    throw new AppError(
      'Esta categoria já foi usada em lançamentos e não pode ser excluída.',
      409,
      'CATEGORY_IN_USE'
    );
  }

  await prisma.category.delete({ where: { id: categoryId } });
}

// Define (ou remove, se null) o orçamento mensal de uma categoria de despesa.
// Categorias padrão (userId null) também podem ter limite definido pelo
// usuário — nesse caso criamos uma cópia pessoal da categoria, para não
// afetar o limite de outros usuários que também usam a categoria padrão.
async function updateCategoryLimit(userId, categoryId, monthlyLimit) {
  const category = await prisma.category.findFirst({
    where: { id: categoryId, type: 'expense', OR: [{ userId: null }, { userId }] },
  });
  if (!category) {
    throw new AppError('Categoria não encontrada.', 404, 'CATEGORY_NOT_FOUND');
  }

  if (category.userId === null) {
    // Categoria padrão (compartilhada) — cria/atualiza uma categoria própria
    // do usuário com o mesmo nome para não vazar o limite para outros.
    const own = await prisma.category.findFirst({ where: { userId, name: category.name, type: 'expense' } });
    if (own) {
      return prisma.category.update({ where: { id: own.id }, data: { monthlyLimit } });
    }
    return prisma.category.create({
      data: { userId, name: category.name, type: 'expense', isDefault: false, monthlyLimit },
    });
  }

  return prisma.category.update({ where: { id: categoryId }, data: { monthlyLimit } });
}

// Retorna, para cada categoria de despesa do usuário com limite definido,
// quanto já foi gasto no mês informado — base para as barras de progresso
// de orçamento na tela de Orçamentos.
async function getBudgetStatus(userId, monthId) {
  const categories = await prisma.category.findMany({
    where: { type: 'expense', OR: [{ userId: null }, { userId }], monthlyLimit: { not: null } },
    orderBy: { name: 'asc' },
  });
  if (categories.length === 0) return [];

  const spentRows = await prisma.expense.groupBy({
    by: ['categoryId'],
    where: { userId, monthId, deletedAt: null, categoryId: { in: categories.map((c) => c.id) } },
    _sum: { value: true },
  });
  const spentMap = Object.fromEntries(spentRows.map((r) => [String(r.categoryId), Number(r._sum.value ?? 0)]));

  return categories.map((c) => {
    const spent = spentMap[String(c.id)] ?? 0;
    const limit = Number(c.monthlyLimit);
    return {
      categoryId: String(c.id),
      categoryName: c.name,
      monthlyLimit: limit,
      spent,
      remaining: Math.round((limit - spent) * 100) / 100,
      percentUsed: limit > 0 ? Math.round((spent / limit) * 1000) / 10 : 0,
      exceeded: spent > limit,
    };
  });
}

module.exports = { listCategories, createCategory, renameCategory, deleteCategory, updateCategoryLimit, getBudgetStatus };
