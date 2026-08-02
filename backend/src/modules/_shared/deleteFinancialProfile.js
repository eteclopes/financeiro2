/**
 * Remove perfis financeiros completos em lote.
 *
 * A maioria das relações do usuário usa cascade, mas cartões, faturas,
 * categorias e alguns históricos têm RESTRICT para impedir exclusões
 * acidentais durante o uso normal. Exclusão explícita de conta/simulação
 * remove as folhas na ordem correta, dentro da mesma transação.
 */
async function deleteFinancialProfiles(userIds, client) {
  const ids = [...new Set((userIds || []).map((id) => BigInt(id)))];
  if (ids.length === 0) return { deletedProfiles: 0 };

  // Libera os guards somente nesta transação administrativa. `true` no
  // terceiro argumento faz a configuração ser LOCAL à transação.
  await client.$executeRawUnsafe("SELECT set_config('financehub.allow_ledger_delete', 'on', true)");

  await client.expense.deleteMany({ where: { userId: { in: ids } } });
  await client.income.deleteMany({ where: { userId: { in: ids } } });
  await client.goalContribution.deleteMany({
    where: { OR: [{ goal: { userId: { in: ids } } }, { month: { userId: { in: ids } } }] },
  });
  await client.savingsTransaction.deleteMany({ where: { userId: { in: ids } } });
  await client.cardInvoice.deleteMany({
    where: { OR: [{ card: { userId: { in: ids } } }, { month: { userId: { in: ids } } }] },
  });
  await client.cardPurchase.deleteMany({ where: { userId: { in: ids } } });
  await client.fixedExpenseTemplate.deleteMany({ where: { userId: { in: ids } } });
  await client.debt.deleteMany({ where: { userId: { in: ids } } });
  await client.incomeTemplate.deleteMany({ where: { userId: { in: ids } } });
  const deleted = await client.user.deleteMany({ where: { id: { in: ids } } });
  return { deletedProfiles: deleted.count };
}

async function deleteFinancialProfile(userId, client) {
  const result = await deleteFinancialProfiles([userId], client);
  if (result.deletedProfiles !== 1) {
    const error = new Error('Financial profile not found');
    error.code = 'P2025';
    throw error;
  }
  return result;
}

module.exports = { deleteFinancialProfile, deleteFinancialProfiles };
