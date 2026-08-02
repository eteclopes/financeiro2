/**
 * Remove um perfil financeiro e todos os registros que usam RESTRICT.
 *
 * A maioria das relações do usuário usa cascade, mas cartões, faturas,
 * categorias e alguns históricos têm RESTRICT para impedir exclusões
 * acidentais durante o uso normal. Exclusão de conta/simulação é um fluxo
 * explícito e precisa remover as folhas na ordem correta.
 */
async function deleteFinancialProfile(userId, client) {
  await client.expense.deleteMany({ where: { userId } });
  await client.income.deleteMany({ where: { userId } });
  await client.goalContribution.deleteMany({
    where: { OR: [{ goal: { userId } }, { month: { userId } }] },
  });
  await client.savingsTransaction.deleteMany({ where: { userId } });
  await client.cardInvoice.deleteMany({
    where: { OR: [{ card: { userId } }, { month: { userId } }] },
  });
  await client.cardPurchase.deleteMany({ where: { userId } });
  await client.fixedExpenseTemplate.deleteMany({ where: { userId } });
  await client.debt.deleteMany({ where: { userId } });
  await client.incomeTemplate.deleteMany({ where: { userId } });
  await client.user.delete({ where: { id: userId } });
}

module.exports = { deleteFinancialProfile };
