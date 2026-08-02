const prisma = require('../../config/prisma');
const { round2 } = require('../../utils/math');

function netIncomeFromAggregate(aggregate) {
  return round2(
    Number(aggregate?._sum?.value ?? 0)
      - Number(aggregate?._sum?.reversedAmount ?? 0)
  );
}

async function aggregateIncome(where, client = prisma) {
  return client.income.aggregate({
    where,
    _sum: { value: true, reversedAmount: true },
  });
}

async function getMonthIncomeTotal(userId, monthId, client = prisma) {
  return netIncomeFromAggregate(await aggregateIncome({ userId, monthId }, client));
}

async function getMonthsIncomeTotal(userId, monthIds, client = prisma) {
  if (!monthIds?.length) return 0;
  return netIncomeFromAggregate(await aggregateIncome({ userId, monthId: { in: monthIds } }, client));
}

module.exports = {
  netIncomeFromAggregate,
  aggregateIncome,
  getMonthIncomeTotal,
  getMonthsIncomeTotal,
};
