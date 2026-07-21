const prisma = require('../../config/prisma');
const AppError = require('../../utils/AppError');
const savingsService = require('../savings/savings.service');
const { round2 } = require('../../utils/math');

/**
 * Saldo disponível para GASTAR agora — não é um campo gravado em lugar
 * nenhum, é sempre recalculado na hora (soma de tudo que já entrou menos
 * tudo que já saiu de verdade), pelo mesmo motivo que o resto do app não
 * mantém nenhum total "cacheado": um saldo mantido manualmente é fácil de
 * dessincronizar; um saldo sempre recalculado a partir dos lançamentos
 * reais nunca pode ficar inconsistente com eles.
 *
 * = TUDO que já entrou (soma de Income.value, todos os meses)
 * − TUDO que já saiu de fato (soma de Expense.paidAmount, todos os meses —
 *   não `value`: uma despesa pendente ainda não tirou nada do bolso, e uma
 *   parcela de cartão só conta quando a FATURA é paga, momento em que
 *   `paidAmount` daquelas parcelas passa a refletir o valor pago)
 * − o que está guardado na Reserva Financeira (dinheiro reservado
 *   deliberadamente não é "livre" para gastos do dia a dia)
 */
async function getAvailableBalance(userId) {
  const [incomeAgg, expenseAgg, breakdown] = await Promise.all([
    prisma.income.aggregate({ where: { userId }, _sum: { value: true } }),
    prisma.expense.aggregate({ where: { userId, deletedAt: null }, _sum: { paidAmount: true } }),
    savingsService.getBalanceBreakdown(userId),
  ]);

  const totalIncome = Number(incomeAgg._sum.value ?? 0);
  const totalPaid = Number(expenseAgg._sum.paidAmount ?? 0);
  // Só o que de fato SAIU do saldo disponível para a reserva conta aqui —
  // dinheiro registrado como "já guardado fora do app" (origin='external')
  // nunca esteve no saldo disponível, então não pode ser descontado dele.
  return round2(totalIncome - totalPaid - breakdown.movedFromBalance);
}

/**
 * Barreira única antes de qualquer operação que reduza saldo (pagar
 * despesa, pagar parcela de dívida, pagar fatura, criar despesa já como
 * paga, mover dinheiro pra reserva). Lança 422 se o valor pedido for maior
 * que o disponível — a operação chamadora deve rodar isto ANTES de
 * qualquer escrita no banco, nunca depois, para nunca deixar o saldo
 * negativo nem por uma fração de segundo.
 */
async function assertSufficientBalance(userId, amount) {
  const available = await getAvailableBalance(userId);
  if (round2(amount) > available + 0.009) {
    throw new AppError(
      `Saldo insuficiente para esta operação (disponível: R$ ${available.toFixed(2)}).`,
      422,
      'INSUFFICIENT_BALANCE',
      { availableBalance: available, requestedAmount: round2(amount) }
    );
  }
  return available;
}

module.exports = { getAvailableBalance, assertSufficientBalance };
