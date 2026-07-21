const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const INCOME_CATEGORIES = [
  'Salário','Freelance','Comissões','Vendas','Aluguel Recebido',
  'Dividendos','Investimentos','Presente','Reembolso','Outros',
];

const EXPENSE_CATEGORIES = [
  'Alimentação','Transporte','Moradia','Saúde','Lazer','Estética',
  'Educação','Investimentos','Pets','Roupas','Tecnologia',
  'Presentes','Viagens','Impostos','Contas','Outros',
];

/**
 * CORREÇÃO BUG 1: MySQL trata NULL != NULL em UNIQUE KEYs, portanto
 * upsert com userId=null via @@unique([userId, name, type]) nunca encontra
 * a linha existente e tenta inserir — ou falha silenciosamente.
 * Solução: findFirst + create manual, sem depender do upsert por null.
 */
async function ensureCategory(name, type) {
  const existing = await prisma.category.findFirst({
    where: { userId: null, name, type },
  });
  if (!existing) {
    await prisma.category.create({
      data: { name, type, isDefault: true, userId: null },
    });
  }
}

async function main() {
  for (const name of INCOME_CATEGORIES) {
    await ensureCategory(name, 'income');
  }
  for (const name of EXPENSE_CATEGORIES) {
    await ensureCategory(name, 'expense');
  }

  const totalIncome  = await prisma.category.count({ where: { type: 'income',  userId: null } });
  const totalExpense = await prisma.category.count({ where: { type: 'expense', userId: null } });
  console.log(`Seed concluído: ${totalIncome} cat. de receita, ${totalExpense} cat. de despesa.`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
