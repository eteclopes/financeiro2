const prisma = require('../../config/prisma');

/**
 * Centraliza consultas que vários módulos precisam ("média dos últimos N
 * meses", etc.) — antes duplicadas em financialHealth.service.js e
 * alerts.service.js, agora usadas por todos os módulos novos também.
 */

async function getRecentMonths(userId, monthId, count) {
  const allMonths = await prisma.month.findMany({
    where: { userId },
    orderBy: [{ year: 'asc' }, { month: 'asc' }],
  });
  const idx = allMonths.findIndex((m) => m.id === monthId);
  if (idx === -1) return [];
  const start = Math.max(0, idx - count + 1);
  return allMonths.slice(start, idx + 1);
}

async function getAllMonthsChronological(userId) {
  return prisma.month.findMany({ where: { userId }, orderBy: [{ year: 'asc' }, { month: 'asc' }] });
}

async function getAverageRecentIncome(userId, monthId, count = 3) {
  const months = await getRecentMonths(userId, monthId, count);
  if (months.length === 0) return 0;
  const agg = await prisma.income.aggregate({
    where: { userId, monthId: { in: months.map((m) => m.id) } },
    _sum: { value: true },
  });
  return Number(agg._sum.value ?? 0) / months.length;
}

async function getAverageRecentExpense(userId, monthId, count = 3, field = 'paidAmount') {
  const months = await getRecentMonths(userId, monthId, count);
  if (months.length === 0) return 0;
  const agg = await prisma.expense.aggregate({
    where: { userId, monthId: { in: months.map((m) => m.id) }, deletedAt: null },
    _sum: { [field]: true },
  });
  return Number(agg._sum[field] ?? 0) / months.length;
}

module.exports = {
  getRecentMonths,
  getAllMonthsChronological,
  getAverageRecentIncome,
  getAverageRecentExpense,
};
