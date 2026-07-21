const prisma = require('../../config/prisma');
const AppError = require('../../utils/AppError');
const { recordAuditLog } = require('../auditLog/auditLog.service');
const { round2 } = require('../../utils/math');
const { assertSufficientBalance, lockUserBalance } = require('../_shared/balance');
const { isFutureDate } = require('../../utils/dateTime');


function assertTransactionDateNotFuture(date) {
  if (isFutureDate(date)) {
    throw new AppError('Não é possível registrar uma movimentação com data futura.', 422, 'FUTURE_TRANSACTION_DATE');
  }
}

async function getCurrentBalance(userId) {
  const last = await prisma.savingsTransaction.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
  return last ? Number(last.balanceAfter) : 0;
}

async function listTransactions(userId) {
  return prisma.savingsTransaction.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
}

async function deposit(userId, { value, date, observation, origin = 'balance' }) {
  assertTransactionDateNotFuture(date);
  // Sem lock, duas chamadas concorrentes (duplo clique, retry de rede) podem
  // ler o mesmo currentBalance e gravar dois balanceAfter incorretos (lost
  // update) — mesma classe de bug que closing.service.js já trava com
  // `FOR UPDATE`. Aqui não há uma linha "de saldo" para travar (o saldo é
  // derivado da última transação), então usamos um lock consultivo por
  // usuário: serializa apenas depósitos/saques do MESMO usuário entre si e
  // é liberado automaticamente ao fim da transação.
  return prisma.$transaction(async (tx) => {
    await lockUserBalance(tx, userId);
    if (origin === 'balance') {
      await assertSufficientBalance(userId, value, tx);
    }

    const last = await tx.savingsTransaction.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    const currentBalance = last ? Number(last.balanceAfter) : 0;
    const balanceAfter = round2(currentBalance + value);

    // Só um depósito com origin='balance' sai do "bolso" do mês corrente —
    // ver getNetMovementInRange e _shared/balance.getAvailableBalance, que
    // tratam origin='external' como dinheiro que nunca esteve no saldo
    // disponível (só está sendo registrado agora, não está "saindo" de lugar nenhum).
    return tx.savingsTransaction.create({
      data: { userId, type: 'deposit', value, transactionDate: date, observation, balanceAfter, origin },
    });
  }).then(async (created) => {
    await recordAuditLog(userId, 'savingsTransaction', created.id, 'deposit', { newValue: created });
    return created;
  });
}

async function withdraw(userId, { value, date, observation }) {
  assertTransactionDateNotFuture(date);
  return prisma.$transaction(async (tx) => {
    await lockUserBalance(tx, userId);

    const last = await tx.savingsTransaction.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    const currentBalance = last ? Number(last.balanceAfter) : 0;

    if (value > currentBalance + 0.009) {
      throw new AppError(
        `Saldo guardado insuficiente. Disponível: R$ ${currentBalance.toFixed(2)}.`,
        409,
        'INSUFFICIENT_SAVINGS_BALANCE'
      );
    }
    const balanceAfter = round2(currentBalance - value);

    return tx.savingsTransaction.create({
      data: { userId, type: 'withdraw', value, transactionDate: date, observation, balanceAfter },
    });
  }).then(async (created) => {
    await recordAuditLog(userId, 'savingsTransaction', created.id, 'withdraw', { newValue: created });
    return created;
  });
}

/**
 * Edita o lançamento mais recente do extrato de poupança. É seguro porque
 * balanceAfter é uma cadeia sequencial (cada lançamento depende apenas do
 * anterior) — mexer em QUALQUER lançamento que não seja o último exigiria
 * recalcular o balanceAfter de todos os posteriores em cascata. Editar
 * apenas o último não tem esse problema: não existe nada depois dele.
 * Não permite trocar `type` (deposit<->withdraw) — isso mudaria o sentido
 * do lançamento; para isso o usuário deve excluir e lançar de novo.
 */
async function updateLastTransaction(userId, transactionId, { value, date, observation, origin }) {
  assertTransactionDateNotFuture(date);
  return prisma.$transaction(async (tx) => {
    await lockUserBalance(tx, userId);

    const last = await tx.savingsTransaction.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    if (!last || String(last.id) !== String(transactionId)) {
      throw new AppError(
        'Só é possível editar o lançamento mais recente do extrato de poupança. Para corrigir um lançamento mais antigo, é preciso desfazer os posteriores primeiro.',
        409,
        'NOT_LAST_SAVINGS_TRANSACTION'
      );
    }

    // Saldo antes deste lançamento = desfaz o próprio efeito dele sobre o balanceAfter salvo.
    const balanceBeforeThis = last.type === 'deposit'
      ? round2(Number(last.balanceAfter) - Number(last.value))
      : round2(Number(last.balanceAfter) + Number(last.value));

    if (last.type === 'withdraw' && value > balanceBeforeThis + 0.009) {
      throw new AppError(
        `Saldo guardado insuficiente para esse valor. Disponível antes deste lançamento: R$ ${balanceBeforeThis.toFixed(2)}.`,
        409,
        'INSUFFICIENT_SAVINGS_BALANCE'
      );
    }

    const oldBalanceImpact = last.type === 'deposit' && last.origin === 'balance'
      ? Number(last.value)
      : last.type === 'withdraw'
        ? -Number(last.value)
        : 0;
    const nextOrigin = last.type === 'deposit' ? (origin ?? last.origin) : null;
    const newBalanceImpact = last.type === 'deposit' && nextOrigin === 'balance'
      ? value
      : last.type === 'withdraw'
        ? -value
        : 0;
    const additionalConsumption = round2(newBalanceImpact - oldBalanceImpact);
    if (additionalConsumption > 0) {
      await assertSufficientBalance(userId, additionalConsumption, tx);
    }

    const balanceAfter = last.type === 'deposit'
      ? round2(balanceBeforeThis + value)
      : round2(balanceBeforeThis - value);

    const updated = await tx.savingsTransaction.update({
      where: { id: last.id },
      data: { value, transactionDate: date, observation, balanceAfter, ...(last.type === 'deposit' && origin ? { origin } : {}) },
    });
    return { updated, oldValue: last };
  }).then(async ({ updated, oldValue }) => {
    await recordAuditLog(userId, 'savingsTransaction', updated.id, 'update', { oldValue, newValue: updated });
    return updated;
  });
}

/**
 * Exclui o lançamento mais recente do extrato — mesma justificativa de
 * segurança de updateLastTransaction. Como não há nada depois dele na
 * cadeia, remover não deixa nenhum balanceAfter desatualizado para trás.
 */
async function deleteLastTransaction(userId, transactionId) {
  return prisma.$transaction(async (tx) => {
    await lockUserBalance(tx, userId);

    const last = await tx.savingsTransaction.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    if (!last || String(last.id) !== String(transactionId)) {
      throw new AppError(
        'Só é possível excluir o lançamento mais recente do extrato de poupança. Para remover um lançamento mais antigo, é preciso desfazer os posteriores primeiro.',
        409,
        'NOT_LAST_SAVINGS_TRANSACTION'
      );
    }

    // Excluir uma retirada remove dinheiro que já havia voltado ao saldo
    // disponível. Se esse dinheiro já foi gasto, a exclusão não pode criar
    // um caixa negativo retroativo.
    if (last.type === 'withdraw') {
      await assertSufficientBalance(userId, Number(last.value), tx);
    }

    await tx.savingsTransaction.delete({ where: { id: last.id } });
    return last;
  }).then(async (deleted) => {
    await recordAuditLog(userId, 'savingsTransaction', deleted.id, 'delete', { oldValue: deleted });
    return deleted;
  });
}

/**
 * Soma líquida de movimentações de saldo guardado dentro de um intervalo de
 * datas (tipicamente o mês selecionado no dashboard). Depósito com
 * origin='balance' é saída de caixa do mês (positivo aqui = deve ser
 * subtraído do saldo atual); retirada é entrada (negativo aqui = deve ser
 * somado). Depósito com origin='external' NÃO entra nessa conta — é
 * dinheiro que já estava guardado fora do app, nunca saiu do saldo deste
 * mês (só está sendo registrado agora).
 */
async function getNetMovementInRange(userId, startDate, endDate) {
  const [deposits, withdraws] = await Promise.all([
    prisma.savingsTransaction.aggregate({
      where: { userId, type: 'deposit', origin: 'balance', transactionDate: { gte: startDate, lte: endDate } },
      _sum: { value: true },
    }),
    prisma.savingsTransaction.aggregate({
      where: { userId, type: 'withdraw', transactionDate: { gte: startDate, lte: endDate } },
      _sum: { value: true },
    }),
  ]);

  return round2(Number(deposits._sum.value ?? 0) - Number(withdraws._sum.value ?? 0));
}

/**
 * Resumo pedido explicitamente pela reforma da reserva: quanto está
 * reservado no total, quanto disso realmente saiu do saldo disponível, e
 * quanto foi só informado como dinheiro que já estava guardado fora do
 * app. `totalReserved` = `movedFromBalance` + `externalReported` sempre
 * (menos qualquer saque, que sai proporcionalmente do total).
 */
async function getBalanceBreakdown(userId) {
  const [totalReserved, movedFromBalanceAgg, externalAgg, withdrawnAgg] = await Promise.all([
    getCurrentBalance(userId),
    prisma.savingsTransaction.aggregate({ where: { userId, type: 'deposit', origin: 'balance' }, _sum: { value: true } }),
    prisma.savingsTransaction.aggregate({ where: { userId, type: 'deposit', origin: 'external' }, _sum: { value: true } }),
    prisma.savingsTransaction.aggregate({ where: { userId, type: 'withdraw' }, _sum: { value: true } }),
  ]);

  const withdrawn = Number(withdrawnAgg._sum.value ?? 0);
  const originallyMoved = Number(movedFromBalanceAgg._sum.value ?? 0);
  // Para exibição, considera que retiradas consomem primeiro o dinheiro que
  // saiu do saldo do app. Assim nenhum componente fica negativo e a soma
  // continua exatamente igual ao total ainda reservado.
  const movedFromBalance = round2(Math.max(originallyMoved - withdrawn, 0));
  const externalReported = round2(Math.max(totalReserved - movedFromBalance, 0));
  return { totalReserved, movedFromBalance, externalReported };
}

module.exports = { getCurrentBalance, listTransactions, deposit, withdraw, updateLastTransaction, deleteLastTransaction, getNetMovementInRange, getBalanceBreakdown };
