const { randomUUID } = require('node:crypto');
const prisma = require('../../config/prisma');
const AppError = require('../../utils/AppError');
const { recordAuditLog } = require('../auditLog/auditLog.service');
const { round2 } = require('../../utils/math');
const { assertSufficientBalance, lockUserBalance } = require('../_shared/balance');
const monthsService = require('../months/months.service');
const latestOrder = [{ createdAt: 'desc' }, { id: 'desc' }];

async function ensureDefaultBucket(userId, client = prisma) {
  const existing = await client.savingsBucket.findFirst({
    where: { userId, isDefault: true },
  });
  if (existing) return existing;

  // ON CONFLICT DO NOTHING é importante aqui. Uma captura comum de erro de
  // unique dentro de uma transação PostgreSQL deixaria a transação abortada,
  // impedindo até a consulta de recuperação. Esta forma é idempotente tanto
  // em requests normais quanto dentro de prisma.$transaction.
  await client.$executeRaw`
    INSERT INTO "savings_buckets"
      ("user_id", "kind", "name", "target_value", "is_default", "is_archived", "created_at", "updated_at")
    VALUES
      (${userId}, 'general', NULL, NULL, true, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT DO NOTHING
  `;

  const initialized = await client.savingsBucket.findFirst({
    where: { userId, isDefault: true },
  });
  if (!initialized) {
    throw new AppError('Não foi possível inicializar a caixinha principal.', 500, 'DEFAULT_SAVINGS_BUCKET_INIT_FAILED');
  }
  return initialized;
}

async function getBucketOrThrow(userId, bucketId, client = prisma, { allowArchived = false } = {}) {
  const bucket = await client.savingsBucket.findFirst({
    where: {
      id: BigInt(bucketId),
      userId,
      ...(allowArchived ? {} : { isArchived: false }),
    },
  });
  if (!bucket) throw new AppError('Caixinha não encontrada.', 404, 'SAVINGS_BUCKET_NOT_FOUND');
  return bucket;
}

async function resolveBucket(userId, bucketId, client = prisma) {
  if (bucketId != null && bucketId !== '') return getBucketOrThrow(userId, bucketId, client);
  return ensureDefaultBucket(userId, client);
}

async function getCurrentBalance(userId, client = prisma) {
  const last = await client.savingsTransaction.findFirst({
    where: { userId },
    orderBy: latestOrder,
  });
  return last ? Number(last.balanceAfter) : 0;
}

async function getBucketBalance(userId, bucketId, client = prisma) {
  const last = await client.savingsTransaction.findFirst({
    where: { userId, bucketId: BigInt(bucketId) },
    orderBy: latestOrder,
  });
  return last ? Number(last.bucketBalanceAfter) : 0;
}

async function listBucketsByArchiveStatus(userId, isArchived) {
  await ensureDefaultBucket(userId);
  const buckets = await prisma.savingsBucket.findMany({
    where: { userId, isArchived },
    include: {
      transactions: {
        orderBy: latestOrder,
        take: 1,
        select: { bucketBalanceAfter: true },
      },
    },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });

  return buckets.map(({ transactions, ...bucket }) => ({
    ...bucket,
    balance: Number(transactions[0]?.bucketBalanceAfter ?? 0),
    progress: bucket.targetValue && Number(bucket.targetValue) > 0
      ? round2(Math.min((Number(transactions[0]?.bucketBalanceAfter ?? 0) / Number(bucket.targetValue)) * 100, 100))
      : null,
  }));
}

async function listBuckets(userId) {
  return listBucketsByArchiveStatus(userId, false);
}

async function listArchivedBuckets(userId) {
  return listBucketsByArchiveStatus(userId, true);
}

async function listTransactions(userId) {
  return prisma.savingsTransaction.findMany({
    where: { userId },
    include: { bucket: true },
    orderBy: latestOrder,
  });
}

async function createBucket(userId, { kind = 'custom', name, targetValue }) {
  if (kind === 'general') {
    throw new AppError('A finalidade Reserva geral é exclusiva da caixinha principal.', 422, 'GENERAL_BUCKET_RESERVED');
  }
  const cleanName = name?.trim() || null;
  if (kind === 'custom' && !cleanName) {
    throw new AppError('Informe um nome para a caixinha personalizada.', 422, 'BUCKET_NAME_REQUIRED');
  }
  return prisma.savingsBucket.create({
    data: {
      userId,
      kind,
      name: cleanName,
      targetValue: targetValue == null || targetValue === '' ? null : targetValue,
    },
  });
}

async function updateBucket(userId, bucketId, { kind, name, targetValue }) {
  const bucket = await getBucketOrThrow(userId, bucketId, prisma, { allowArchived: true });
  const nextKind = kind ?? bucket.kind;
  const nextName = name === undefined ? bucket.name : (name?.trim() || null);
  if (nextKind === 'general' && !bucket.isDefault) {
    throw new AppError('A finalidade Reserva geral é exclusiva da caixinha principal.', 422, 'GENERAL_BUCKET_RESERVED');
  }
  if (nextKind === 'custom' && !nextName) {
    throw new AppError('Informe um nome para a caixinha personalizada.', 422, 'BUCKET_NAME_REQUIRED');
  }
  return prisma.savingsBucket.update({
    where: { id: bucket.id },
    data: {
      ...(kind ? { kind } : {}),
      ...(name !== undefined ? { name: nextName } : {}),
      ...(targetValue !== undefined
        ? { targetValue: targetValue == null || targetValue === '' ? null : targetValue }
        : {}),
    },
  });
}

async function archiveBucket(userId, bucketId) {
  return prisma.$transaction(async (tx) => {
    await lockUserBalance(tx, userId);
    const bucket = await getBucketOrThrow(userId, bucketId, tx);
    if (bucket.isDefault) {
      throw new AppError('A caixinha padrão não pode ser arquivada. Você pode renomeá-la e alterar sua finalidade.', 409, 'DEFAULT_BUCKET_CANNOT_ARCHIVE');
    }
    const balance = await getBucketBalance(userId, bucket.id, tx);
    if (balance > 0.009) {
      throw new AppError('Transfira ou retire todo o saldo antes de arquivar esta caixinha.', 409, 'BUCKET_HAS_BALANCE');
    }
    return tx.savingsBucket.update({ where: { id: bucket.id }, data: { isArchived: true } });
  });
}

async function restoreBucket(userId, bucketId) {
  const bucket = await getBucketOrThrow(userId, bucketId, prisma, { allowArchived: true });
  if (!bucket.isArchived) return bucket;
  return prisma.savingsBucket.update({ where: { id: bucket.id }, data: { isArchived: false } });
}

async function deposit(userId, { value, date, observation, origin = 'balance', bucketId }) {
  return prisma.$transaction(async (tx) => {
    await lockUserBalance(tx, userId);
    await monthsService.assertTransactionDateIsOpen(userId, date, tx);
    const bucket = await resolveBucket(userId, bucketId, tx);
    if (origin === 'balance') await assertSufficientBalance(userId, value, tx);

    const [last, lastInBucket] = await Promise.all([
      tx.savingsTransaction.findFirst({ where: { userId }, orderBy: latestOrder }),
      tx.savingsTransaction.findFirst({ where: { userId, bucketId: bucket.id }, orderBy: latestOrder }),
    ]);
    const currentBalance = Number(last?.balanceAfter ?? 0);
    const currentBucketBalance = Number(lastInBucket?.bucketBalanceAfter ?? lastInBucket?.balanceAfter ?? 0);

    return tx.savingsTransaction.create({
      data: {
        userId,
        bucketId: bucket.id,
        type: 'deposit',
        value,
        transactionDate: date,
        observation,
        origin,
        balanceAfter: round2(currentBalance + value),
        bucketBalanceAfter: round2(currentBucketBalance + value),
      },
      include: { bucket: true },
    });
  }).then(async (created) => {
    await recordAuditLog(userId, 'savingsTransaction', created.id, 'deposit', { newValue: created });
    return created;
  });
}

async function withdraw(userId, { value, date, observation, bucketId }) {
  return prisma.$transaction(async (tx) => {
    await lockUserBalance(tx, userId);
    await monthsService.assertTransactionDateIsOpen(userId, date, tx);
    const bucket = await resolveBucket(userId, bucketId, tx);
    const [last, lastInBucket] = await Promise.all([
      tx.savingsTransaction.findFirst({ where: { userId }, orderBy: latestOrder }),
      tx.savingsTransaction.findFirst({ where: { userId, bucketId: bucket.id }, orderBy: latestOrder }),
    ]);
    const currentBalance = Number(last?.balanceAfter ?? 0);
    const currentBucketBalance = Number(lastInBucket?.bucketBalanceAfter ?? lastInBucket?.balanceAfter ?? 0);

    if (value > currentBucketBalance + 0.009) {
      throw new AppError(
        `Saldo insuficiente nesta caixinha. Disponível: R$ ${currentBucketBalance.toFixed(2)}.`,
        409,
        'INSUFFICIENT_SAVINGS_BALANCE'
      );
    }

    return tx.savingsTransaction.create({
      data: {
        userId,
        bucketId: bucket.id,
        type: 'withdraw',
        value,
        transactionDate: date,
        observation,
        balanceAfter: round2(currentBalance - value),
        bucketBalanceAfter: round2(currentBucketBalance - value),
      },
      include: { bucket: true },
    });
  }).then(async (created) => {
    await recordAuditLog(userId, 'savingsTransaction', created.id, 'withdraw', { newValue: created });
    return created;
  });
}

async function transfer(userId, { fromBucketId, toBucketId, value, date, observation }) {
  if (String(fromBucketId) === String(toBucketId)) {
    throw new AppError('Escolha duas caixinhas diferentes.', 422, 'SAME_BUCKET_TRANSFER');
  }

  return prisma.$transaction(async (tx) => {
    await lockUserBalance(tx, userId);
    await monthsService.assertTransactionDateIsOpen(userId, date, tx);
    const [source, destination] = await Promise.all([
      getBucketOrThrow(userId, fromBucketId, tx),
      getBucketOrThrow(userId, toBucketId, tx),
    ]);
    const [globalLast, sourceLast, destinationLast] = await Promise.all([
      tx.savingsTransaction.findFirst({ where: { userId }, orderBy: latestOrder }),
      tx.savingsTransaction.findFirst({ where: { userId, bucketId: source.id }, orderBy: latestOrder }),
      tx.savingsTransaction.findFirst({ where: { userId, bucketId: destination.id }, orderBy: latestOrder }),
    ]);

    const totalBalance = Number(globalLast?.balanceAfter ?? 0);
    const sourceBalance = Number(sourceLast?.bucketBalanceAfter ?? sourceLast?.balanceAfter ?? 0);
    const destinationBalance = Number(destinationLast?.bucketBalanceAfter ?? destinationLast?.balanceAfter ?? 0);
    if (value > sourceBalance + 0.009) {
      throw new AppError(
        `Saldo insuficiente na caixinha de origem. Disponível: R$ ${sourceBalance.toFixed(2)}.`,
        409,
        'INSUFFICIENT_SAVINGS_BALANCE'
      );
    }

    const transferId = randomUUID();
    const outgoing = await tx.savingsTransaction.create({
      data: {
        userId,
        bucketId: source.id,
        type: 'withdraw',
        value,
        origin: 'balance',
        transactionDate: date,
        observation,
        balanceAfter: round2(totalBalance - value),
        bucketBalanceAfter: round2(sourceBalance - value),
        transferId,
      },
      include: { bucket: true },
    });
    const incoming = await tx.savingsTransaction.create({
      data: {
        userId,
        bucketId: destination.id,
        type: 'deposit',
        value,
        origin: 'balance',
        transactionDate: date,
        observation,
        balanceAfter: round2(totalBalance),
        bucketBalanceAfter: round2(destinationBalance + value),
        transferId,
      },
      include: { bucket: true },
    });
    return { outgoing, incoming, transferId };
  }).then(async (result) => {
    await recordAuditLog(userId, 'savingsTransfer', result.outgoing.id, 'transfer', {
      fields: ['fromBucketId', 'toBucketId', 'value'],
    });
    return result;
  });
}

async function updateLastTransaction(userId, transactionId, { value, date, observation, origin }) {
  return prisma.$transaction(async (tx) => {
    await lockUserBalance(tx, userId);
    await monthsService.assertTransactionDateIsOpen(userId, date, tx);
    const last = await tx.savingsTransaction.findFirst({ where: { userId }, orderBy: latestOrder });
    if (!last || String(last.id) !== String(transactionId)) {
      throw new AppError(
        'Só é possível editar o lançamento mais recente do extrato de poupança.',
        409,
        'NOT_LAST_SAVINGS_TRANSACTION'
      );
    }
    if (last.transferId) {
      throw new AppError('Transferências entre caixinhas não podem ser editadas. Faça uma transferência inversa.', 409, 'TRANSFER_IMMUTABLE');
    }

    const balanceBeforeThis = last.type === 'deposit'
      ? round2(Number(last.balanceAfter) - Number(last.value))
      : round2(Number(last.balanceAfter) + Number(last.value));
    const bucketBalanceBeforeThis = last.type === 'deposit'
      ? round2(Number(last.bucketBalanceAfter ?? last.balanceAfter) - Number(last.value))
      : round2(Number(last.bucketBalanceAfter ?? last.balanceAfter) + Number(last.value));

    if (last.type === 'withdraw' && value > bucketBalanceBeforeThis + 0.009) {
      throw new AppError(
        `Saldo insuficiente nesta caixinha. Disponível antes deste lançamento: R$ ${bucketBalanceBeforeThis.toFixed(2)}.`,
        409,
        'INSUFFICIENT_SAVINGS_BALANCE'
      );
    }

    const oldBalanceImpact = last.type === 'deposit' && last.origin === 'balance'
      ? Number(last.value)
      : last.type === 'withdraw' ? -Number(last.value) : 0;
    const nextOrigin = last.type === 'deposit' ? (origin ?? last.origin) : null;
    const newBalanceImpact = last.type === 'deposit' && nextOrigin === 'balance'
      ? value
      : last.type === 'withdraw' ? -value : 0;
    const additionalConsumption = round2(newBalanceImpact - oldBalanceImpact);
    if (additionalConsumption > 0) await assertSufficientBalance(userId, additionalConsumption, tx);

    const updated = await tx.savingsTransaction.update({
      where: { id: last.id },
      data: {
        value,
        transactionDate: date,
        observation,
        balanceAfter: last.type === 'deposit'
          ? round2(balanceBeforeThis + value)
          : round2(balanceBeforeThis - value),
        bucketBalanceAfter: last.type === 'deposit'
          ? round2(bucketBalanceBeforeThis + value)
          : round2(bucketBalanceBeforeThis - value),
        ...(last.type === 'deposit' && origin ? { origin } : {}),
      },
      include: { bucket: true },
    });
    return { updated, oldValue: last };
  }).then(async ({ updated, oldValue }) => {
    await recordAuditLog(userId, 'savingsTransaction', updated.id, 'update', { oldValue, newValue: updated });
    return updated;
  });
}

async function deleteLastTransaction(userId, transactionId) {
  return prisma.$transaction(async (tx) => {
    await lockUserBalance(tx, userId);
    const last = await tx.savingsTransaction.findFirst({ where: { userId }, orderBy: latestOrder });
    if (!last || String(last.id) !== String(transactionId)) {
      throw new AppError('Só é possível excluir o lançamento mais recente do extrato de poupança.', 409, 'NOT_LAST_SAVINGS_TRANSACTION');
    }
    if (last.transferId) {
      throw new AppError('Transferências entre caixinhas não podem ser excluídas. Faça uma transferência inversa.', 409, 'TRANSFER_IMMUTABLE');
    }
    if (last.type === 'withdraw') await assertSufficientBalance(userId, Number(last.value), tx);
    await tx.savingsTransaction.delete({ where: { id: last.id } });
    return last;
  }).then(async (deleted) => {
    await recordAuditLog(userId, 'savingsTransaction', deleted.id, 'delete', { oldValue: deleted });
    return deleted;
  });
}

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

async function getBalanceBreakdown(userId) {
  const [totalReserved, movedFromBalanceAgg, externalAgg, withdrawnAgg] = await Promise.all([
    getCurrentBalance(userId),
    prisma.savingsTransaction.aggregate({ where: { userId, type: 'deposit', origin: 'balance' }, _sum: { value: true } }),
    prisma.savingsTransaction.aggregate({ where: { userId, type: 'deposit', origin: 'external' }, _sum: { value: true } }),
    prisma.savingsTransaction.aggregate({ where: { userId, type: 'withdraw' }, _sum: { value: true } }),
  ]);
  const withdrawn = Number(withdrawnAgg._sum.value ?? 0);
  const originallyMoved = Number(movedFromBalanceAgg._sum.value ?? 0);
  const movedFromBalance = round2(Math.max(originallyMoved - withdrawn, 0));
  const externalReported = round2(Math.max(totalReserved - movedFromBalance, 0));
  return { totalReserved, movedFromBalance, externalReported };
}

module.exports = {
  ensureDefaultBucket,
  getCurrentBalance,
  getBucketBalance,
  listBuckets,
  listArchivedBuckets,
  listTransactions,
  createBucket,
  updateBucket,
  archiveBucket,
  restoreBucket,
  deposit,
  withdraw,
  transfer,
  updateLastTransaction,
  deleteLastTransaction,
  getNetMovementInRange,
  getBalanceBreakdown,
};
