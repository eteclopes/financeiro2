const prisma = require('../../config/prisma');
const AppError = require('../../utils/AppError');
const { round2 } = require('../../utils/math');
const { getAvailableBalance } = require('../_shared/balance');
const paymentsService = require('../payments/payments.service');
const savingsService = require('../savings/savings.service');
const monthsService = require('../months/months.service');
const { todayUtcDate } = require('../../utils/dateTime');

const DEFAULTS = {
  payDuesOnClose: false,
  payDuesMethod: 'debit',
  saveLeftoverOnClose: false,
  saveLeftoverType: 'percent',
  saveLeftoverValue: 0,
  saveLeftoverBucketId: null,
};

function serialize(row) {
  if (!row) return { ...DEFAULTS };
  return {
    payDuesOnClose: row.payDuesOnClose,
    payDuesMethod: row.payDuesMethod,
    saveLeftoverOnClose: row.saveLeftoverOnClose,
    saveLeftoverType: row.saveLeftoverType,
    saveLeftoverValue: Number(row.saveLeftoverValue ?? 0),
    saveLeftoverBucketId: row.saveLeftoverBucketId ? String(row.saveLeftoverBucketId) : null,
  };
}

async function getSettings(userId) {
  const row = await prisma.automationSetting.findUnique({ where: { userId } });
  return serialize(row);
}

async function updateSettings(userId, data) {
  // Se escolheu uma caixinha, valida que é do usuário e não está arquivada.
  let bucketId = null;
  if (data.saveLeftoverBucketId) {
    const bucket = await prisma.savingsBucket.findFirst({
      where: { id: BigInt(data.saveLeftoverBucketId), userId, isArchived: false },
    });
    if (!bucket) throw new AppError('Caixinha de reserva inválida.', 422, 'INVALID_BUCKET');
    bucketId = bucket.id;
  }

  const payload = {
    payDuesOnClose: !!data.payDuesOnClose,
    payDuesMethod: data.payDuesMethod === 'cash' ? 'cash' : 'debit',
    saveLeftoverOnClose: !!data.saveLeftoverOnClose,
    saveLeftoverType: data.saveLeftoverType === 'fixed' ? 'fixed' : 'percent',
    saveLeftoverValue: round2(Math.max(Number(data.saveLeftoverValue ?? 0), 0)),
    saveLeftoverBucketId: bucketId,
  };

  const row = await prisma.automationSetting.upsert({
    where: { userId },
    create: { userId, ...payload },
    update: payload,
  });
  return serialize(row);
}

/**
 * PAGAMENTO AUTOMÁTICO — paga o que vence no mês, em ORDEM DE PRIORIDADE
 * (dívidas -> contas -> faturas), grupo a grupo. Cada grupo é atômico
 * (reusa payBillsBatch, que trava o saldo e confere o total). Se um grupo
 * não couber no saldo, ele é PULADO e seguimos para os mais baratos — nunca
 * fica negativo. Idempotente: itens já pagos são ignorados.
 *
 * Retorna um resumo do que foi pago e do que foi pulado por falta de saldo.
 */
async function runAutoPayments(userId, monthId, method = 'debit') {
  const items = await paymentsService.getPayableItems(userId, monthId);
  const summary = {
    paidDebts: 0, paidBills: 0, paidInvoices: 0,
    totalPaid: 0, skipped: [],
  };

  const groups = [
    { name: 'dívidas', key: 'expenseIds', ids: items.debts.map((i) => i.id), countField: 'paidDebts' },
    { name: 'contas', key: 'expenseIds', ids: items.bills.map((i) => i.id), countField: 'paidBills' },
    { name: 'faturas', key: 'invoiceIds', ids: items.invoices.map((i) => i.id), countField: 'paidInvoices' },
  ];

  for (const group of groups) {
    if (group.ids.length === 0) continue;
    try {
      const res = await paymentsService.payBillsBatch(userId, {
        [group.key]: group.ids,
        paymentMethod: method,
      });
      summary[group.countField] = (res.paidDebtsCount ?? 0) + (res.paidBillsCount ?? 0) + (res.paidInvoicesCount ?? 0);
      summary.totalPaid = round2(summary.totalPaid + (res.total ?? 0));
    } catch (error) {
      // Sem saldo para este grupo: pula e tenta os próximos (mais baratos).
      if (error.code === 'INSUFFICIENT_BALANCE') {
        summary.skipped.push(group.name);
        continue;
      }
      throw error;
    }
  }

  return summary;
}

/**
 * GUARDAR SOBRA — deposita parte do saldo DISPONÍVEL numa caixinha.
 * A "sobra" é o saldo disponível ATUAL (já descontados os pagamentos que
 * rodaram antes). Nunca guarda mais do que há; nunca deixa negativo.
 * Reusa savings.deposit (origin 'balance'), que também confere saldo.
 */
async function runAutoSave(userId, monthId, { type, value, bucketId }) {
  const available = await getAvailableBalance(userId);
  if (available <= 0.009) {
    return { saved: 0, reason: 'sem_sobra' };
  }

  let amount;
  if (type === 'fixed') {
    amount = round2(Math.min(Number(value), available));
  } else {
    const pct = Math.min(Math.max(Number(value), 0), 100);
    amount = round2((available * pct) / 100);
  }
  if (amount <= 0.009) return { saved: 0, reason: 'valor_zero' };

  // Data do depósito: hoje, dentro do mês aberto. Se hoje não estiver no mês
  // selecionado (ex.: rodando no fechamento), usa uma data válida do mês.
  const month = await monthsService.getMonthOrThrow(userId, monthId);
  const depositDate = resolveDateWithinMonth(month);

  try {
    const created = await savingsService.deposit(userId, {
      value: amount,
      date: depositDate,
      observation: 'Reserva automática (sobra do mês)',
      origin: 'balance',
      bucketId: bucketId ? BigInt(bucketId) : undefined,
    });
    return { saved: amount, bucket: created.bucket?.name ?? null };
  } catch (error) {
    // Caixinha apagada no meio do caminho, saldo virou insuficiente, etc.:
    // não deixa a automação derrubar nada — só reporta que não guardou.
    if (['INVALID_BUCKET', 'INSUFFICIENT_BALANCE', 'BUCKET_NOT_FOUND', 'SAVINGS_BUCKET_NOT_FOUND'].includes(error.code)) {
      return { saved: 0, reason: 'falha_reserva' };
    }
    throw error;
  }
}

function resolveDateWithinMonth(month) {
  const today = todayUtcDate();
  const first = new Date(Date.UTC(Number(month.year), Number(month.month) - 1, 1));
  const last = new Date(Date.UTC(Number(month.year), Number(month.month), 0));
  if (today >= first && today <= last) return today;
  // fora do mês: usa o último dia do mês (competência), garantindo abertura.
  return last;
}

/**
 * Executa as automações habilitadas para um mês. Usado tanto pelo "Rodar
 * agora" quanto (indiretamente) após o fechamento. Retorna um resumo.
 *
 * IMPORTANTE: cada automação é isolada. Uma falha inesperada numa não
 * impede as outras nem derruba quem chamou — o resumo indica o que rolou.
 */
async function runNow(userId, monthId, { onlyEnabled = true, settings = null } = {}) {
  const config = settings ?? await getSettings(userId);
  const result = { payments: null, savings: null, ranAt: new Date().toISOString() };

  const shouldPay = !onlyEnabled || config.payDuesOnClose;
  const shouldSave = !onlyEnabled || config.saveLeftoverOnClose;

  if (shouldPay) {
    result.payments = await runAutoPayments(userId, monthId, config.payDuesMethod);
  }
  if (shouldSave) {
    result.savings = await runAutoSave(userId, monthId, {
      type: config.saveLeftoverType,
      value: config.saveLeftoverValue,
      bucketId: config.saveLeftoverBucketId,
    });
  }

  return result;
}

/**
 * Chamado LOGO APÓS o fechamento do mês commitar (fora da transação de
 * fechamento). Roda só as automações ligadas. Qualquer erro é engolido e
 * retornado como aviso — o fechamento já teve sucesso e não pode ser
 * afetado por uma automação.
 */
async function runOnClose(userId, monthId) {
  try {
    const config = await getSettings(userId);
    if (!config.payDuesOnClose && !config.saveLeftoverOnClose) return null;
    return await runNow(userId, monthId, { onlyEnabled: true, settings: config });
  } catch (error) {
    return { error: true, message: 'As automações não puderam ser executadas agora.' };
  }
}

module.exports = {
  getSettings,
  updateSettings,
  runAutoPayments,
  runAutoSave,
  runNow,
  runOnClose,
};
