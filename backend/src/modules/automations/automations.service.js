const prisma = require('../../config/prisma');
const AppError = require('../../utils/AppError');
const { round2 } = require('../../utils/math');
const { getAvailableBalance } = require('../_shared/balance');
const paymentsService = require('../payments/payments.service');
const savingsService = require('../savings/savings.service');
const monthsService = require('../months/months.service');
const projectionsService = require('../projections/projections.service');
const { todayUtcDate } = require('../../utils/dateTime');

const DEFAULTS = {
  payDuesOnClose: false,
  payDuesMethod: 'debit',
  payDebts: true,
  payBills: true,
  payInvoices: true,
  payOpenInvoices: false,
  minimumBalance: 0,
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
    payDebts: row.payDebts ?? true,
    payBills: row.payBills ?? true,
    payInvoices: row.payInvoices ?? true,
    payOpenInvoices: row.payOpenInvoices ?? false,
    minimumBalance: Number(row.minimumBalance ?? 0),
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
    payDebts: data.payDebts === undefined ? true : !!data.payDebts,
    payBills: data.payBills === undefined ? true : !!data.payBills,
    payInvoices: data.payInvoices === undefined ? true : !!data.payInvoices,
    payOpenInvoices: !!data.payOpenInvoices,
    minimumBalance: round2(Math.max(Number(data.minimumBalance ?? 0), 0)),
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
async function runAutoPayments(userId, monthId, config) {
  const method = config.payDuesMethod ?? 'debit';
  const floor = Number(config.minimumBalance ?? 0);

  // Por padrão a automação só quita o que já venceu ou fechou — adiantar uma
  // fatura aberta paga uma conta que ainda vai receber compras. O usuário
  // pode liberar isso conscientemente em `payOpenInvoices`.
  const items = await paymentsService.getPayableItems(userId, monthId, {
    dueOnly: !config.payOpenInvoices,
  });
  const summary = {
    paidDebts: 0, paidBills: 0, paidInvoices: 0,
    totalPaid: 0, skipped: [], blockedByFloor: [],
  };

  const groups = [
    { name: 'dívidas', enabled: config.payDebts !== false, key: 'expenseIds', items: items.debts, countField: 'paidDebts' },
    { name: 'contas',  enabled: config.payBills !== false, key: 'expenseIds', items: items.bills, countField: 'paidBills' },
    { name: 'faturas', enabled: config.payInvoices !== false, key: 'invoiceIds', items: items.invoices, countField: 'paidInvoices' },
  ];

  for (const group of groups) {
    if (!group.enabled || group.items.length === 0) continue;

    // PISO DE SALDO: a automação nunca deixa o saldo abaixo do valor que o
    // usuário definiu como reserva de segurança. Se o grupo não couber
    // dentro dessa folga, ele é pulado por inteiro — nada é pago pela metade.
    const available = round2(await getAvailableBalance(userId) - floor);
    const groupTotal = round2(group.items.reduce((sum, item) => sum + Number(item.amount || 0), 0));
    if (groupTotal > available + 0.009) {
      summary.blockedByFloor.push({ group: group.name, needed: groupTotal, available: round2(Math.max(available, 0)) });
      continue;
    }

    try {
      const res = await paymentsService.payBillsBatch(userId, {
        [group.key]: group.items.map((item) => item.id),
        paymentMethod: method,
      });
      summary[group.countField] = (res.paidDebtsCount ?? 0) + (res.paidBillsCount ?? 0) + (res.paidInvoicesCount ?? 0);
      summary.totalPaid = round2(summary.totalPaid + (res.total ?? 0));
    } catch (error) {
      // Saldo mudou entre a checagem e o pagamento (outra aba, corrida):
      // pula o grupo e segue para os mais baratos. Nunca fica negativo.
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
async function runAutoSave(userId, monthId, { type, value, bucketId, minimumBalance = 0 }) {
  // A "sobra" é o que existe ACIMA do piso de segurança. Guardar dinheiro
  // não pode empurrar o saldo abaixo do que o usuário quer manter em conta.
  const available = round2(await getAvailableBalance(userId) - Number(minimumBalance || 0));
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
 * PRÉVIA DAS AUTOMAÇÕES — mostra, ANTES de qualquer dinheiro sair, o que
 * será pago e quanto será guardado, e valida se o saldo dá conta de tudo
 * sem furar o piso de segurança.
 *
 * `scope`:
 *  - 'current': o que aconteceria agora, no mês selecionado.
 *  - 'next'   : o que acontecerá quando este mês for encerrado. Aqui os
 *               números do mês seguinte ainda não existem no banco, então
 *               são estimados a partir das MESMAS projeções que alimentam o
 *               dashboard: receitas recorrentes, despesas fixas, parcelas de
 *               dívida e parcelas de cartão previstas para aquele mês.
 *
 * A prévia nunca escreve nada. Quando a conta não fecha, ela devolve avisos
 * explicando o que não caberá — em vez de deixar a automação tentar e falhar
 * silenciosamente na virada do mês.
 */
async function previewAutomations(userId, monthId, scope = 'current') {
  const config = await getSettings(userId);
  const balanceNow = round2(await getAvailableBalance(userId));
  const floor = Number(config.minimumBalance ?? 0);
  const warnings = [];

  let groups;
  let expectedIncome = 0;
  let monthLabel;

  if (scope === 'next') {
    const components = await projectionsService.getProjectionComponents(userId, monthId, 2);
    const nextRef = components.months[1];
    monthLabel = { month: nextRef.month, year: nextRef.year };
    expectedIncome = round2(Number(components.recurringIncome || 0));

    // FATURAS: usa o dado REAL, não projeção. A fatura do mês que vem já
    // existe hoje (ela nasce quando a compra cai nela), então estimá-la pelas
    // parcelas do mês dava zero e a simulação aparecia vazia mesmo com fatura
    // em aberto. Aqui somamos o saldo devedor real das faturas que vencem no
    // mês seguinte — e as ainda abertas só entram se o usuário liberou.
    const nextStart = new Date(Date.UTC(nextRef.year, nextRef.month - 1, 1));
    const nextEnd = new Date(Date.UTC(nextRef.year, nextRef.month, 0, 23, 59, 59, 999));
    const nextInvoices = await prisma.cardInvoice.findMany({
      where: {
        card: { userId },
        status: { not: 'paid' },
        dueDate: { gte: nextStart, lte: nextEnd },
      },
      include: {
        expenses: { where: { deletedAt: null, status: { not: 'paid' } }, select: { value: true, paidAmount: true } },
      },
    });
    const invoiceRows = nextInvoices
      .map((invoice) => ({
        stillOpen: invoice.status === 'open',
        amount: round2(invoice.expenses.reduce((acc, e) => acc + (Number(e.value) - Number(e.paidAmount ?? 0)), 0)),
      }))
      .filter((invoice) => invoice.amount > 0);

    const openOnes = invoiceRows.filter((i) => i.stillOpen);
    const payableInvoices = config.payOpenInvoices ? invoiceRows : invoiceRows.filter((i) => !i.stillOpen);
    const invoicesTotal = round2(payableInvoices.reduce((acc, i) => acc + i.amount, 0));

    if (!config.payOpenInvoices && openOnes.length > 0) {
      const totalAberto = round2(openOnes.reduce((acc, i) => acc + i.amount, 0));
      warnings.push({
        level: 'info',
        code: 'FATURA_AINDA_ABERTA',
        message: `${openOnes.length} fatura(s) ainda não fecharam (${totalAberto.toFixed(2)}) e ficam de fora. `
          + 'Ligue "adiantar faturas ainda abertas" se quiser incluí-las.',
      });
    }

    const fixedNonCredit = round2(Number(components.fixedExpenses || 0));
    if (fixedNonCredit === 0 && invoiceRows.length > 0) {
      warnings.push({
        level: 'info',
        code: 'FIXAS_NO_CARTAO',
        message: 'Suas despesas fixas estão no cartão: elas não contam como "contas fixas" aqui, e sim dentro da fatura.',
      });
    }

    groups = [
      { key: 'debts', name: 'Parcelas de dívida', enabled: config.payDebts !== false,
        total: round2(Number(components.debtSchedule?.[1] || 0)), estimated: true },
      { key: 'bills', name: 'Contas fixas', enabled: config.payBills !== false,
        total: fixedNonCredit, estimated: true },
      { key: 'invoices', name: 'Faturas de cartão', enabled: config.payInvoices !== false,
        total: invoicesTotal, estimated: false, excludedOpenCount: config.payOpenInvoices ? 0 : openOnes.length },
    ];
    warnings.push({
      level: 'info',
      code: 'ESTIMATIVA',
      message: 'Números do mês seguinte são estimativas baseadas nos seus lançamentos recorrentes. Compras novas ou contas avulsas podem mudar o total.',
    });
  } else {
    // A prévia olha TUDO (dueOnly: false) para poder EXPLICAR o que ficará de
    // fora. Antes ela usava o mesmo recorte da execução e simplesmente
    // aparecia vazia, sem o usuário entender o motivo.
    const items = await paymentsService.getPayableItems(userId, monthId, { dueOnly: false });
    const month = await monthsService.getMonthOrThrow(userId, monthId);
    monthLabel = { month: month.month, year: month.year };
    const sum = (list) => round2((list || []).reduce((acc, i) => acc + Number(i.amount || 0), 0));

    const allInvoices = items.invoices || [];
    const openOnes = allInvoices.filter((i) => i.stillOpen);
    const payableInvoices = config.payOpenInvoices ? allInvoices : allInvoices.filter((i) => !i.stillOpen);

    if (!config.payOpenInvoices && openOnes.length > 0) {
      const totalAberto = round2(openOnes.reduce((acc, i) => acc + Number(i.amount || 0), 0));
      warnings.push({
        level: 'info',
        code: 'FATURA_AINDA_ABERTA',
        message: `${openOnes.length} fatura(s) ainda não fecharam (${totalAberto.toFixed(2)}) e ficam de fora. `
          + 'Ligue "adiantar faturas ainda abertas" se quiser incluí-las.',
      });
    }

    groups = [
      { key: 'debts', name: 'Parcelas de dívida', enabled: config.payDebts !== false,
        total: sum(items.debts), count: (items.debts || []).length, estimated: false },
      { key: 'bills', name: 'Contas', enabled: config.payBills !== false,
        total: sum(items.bills), count: (items.bills || []).length, estimated: false },
      { key: 'invoices', name: 'Faturas de cartão', enabled: config.payInvoices !== false,
        total: sum(payableInvoices), count: payableInvoices.length, estimated: false,
        excludedOpenCount: config.payOpenInvoices ? 0 : openOnes.length },
    ];

    // O caso que mais confunde: a pessoa tem despesa fixa no cartão e estranha
    // não vê-la em "contas". Ela não é conta comum — está dentro da fatura.
    if (sum(items.bills) === 0 && allInvoices.length > 0) {
      warnings.push({
        level: 'info',
        code: 'FIXAS_NO_CARTAO',
        message: 'Despesas fixas no cartão não aparecem como "contas": elas entram na fatura e são pagas junto com ela.',
      });
    }
  }

  // Simula o caixa na MESMA ordem em que a automação executa: dívidas,
  // contas e faturas, cada grupo só entra se couber inteiro acima do piso.
  let running = round2(balanceNow + expectedIncome);
  let totalToPay = 0;

  for (const group of groups) {
    if (!group.enabled) { group.willPay = false; group.reason = 'desligado'; continue; }
    if (group.total <= 0.009) { group.willPay = false; group.reason = 'nada_a_pagar'; continue; }

    const room = round2(running - floor);
    if (group.total > room + 0.009) {
      group.willPay = false;
      group.reason = 'sem_saldo';
      group.missing = round2(group.total - Math.max(room, 0));
      warnings.push({
        level: 'error',
        code: 'SALDO_INSUFICIENTE',
        group: group.name,
        message: `Não haverá saldo para ${group.name.toLowerCase()}: faltam ${group.missing.toFixed(2)}.`,
      });
      continue;
    }
    group.willPay = true;
    running = round2(running - group.total);
    totalToPay = round2(totalToPay + group.total);
  }

  const balanceAfterPayments = running;

  // Reserva automática, calculada sobre o que sobra ACIMA do piso.
  const savings = {
    enabled: !!config.saveLeftoverOnClose,
    type: config.saveLeftoverType,
    value: Number(config.saveLeftoverValue || 0),
    amount: 0,
  };
  if (savings.enabled) {
    const room = round2(balanceAfterPayments - floor);
    if (room <= 0.009) {
      savings.reason = 'sem_sobra';
      warnings.push({
        level: 'warn',
        code: 'SEM_SOBRA_PARA_RESERVA',
        message: 'Depois dos pagamentos não sobrará nada acima do saldo mínimo, então nada será guardado.',
      });
    } else {
      savings.amount = savings.type === 'fixed'
        ? round2(Math.min(savings.value, room))
        : round2((room * Math.min(Math.max(savings.value, 0), 100)) / 100);
      if (savings.type === 'fixed' && savings.value > room + 0.009) {
        warnings.push({
          level: 'warn',
          code: 'RESERVA_REDUZIDA',
          message: `Só será possível guardar ${savings.amount.toFixed(2)} dos ${savings.value.toFixed(2)} configurados.`,
        });
      }
    }
  }

  const balanceAfterSavings = round2(balanceAfterPayments - savings.amount);

  if (!config.payDuesOnClose && !config.saveLeftoverOnClose) {
    warnings.push({
      level: 'info',
      code: 'NADA_LIGADO',
      message: 'Nenhuma automação está ligada — nada acontecerá ao fechar o mês.',
    });
  }
  if (balanceAfterSavings < floor - 0.009) {
    warnings.push({
      level: 'error',
      code: 'ABAIXO_DO_MINIMO',
      message: 'A combinação atual deixaria o saldo abaixo do mínimo definido.',
    });
  }

  return {
    scope,
    month: monthLabel,
    balanceNow,
    expectedIncome,
    minimumBalance: round2(floor),
    groups,
    totalToPay,
    balanceAfterPayments,
    savings,
    balanceAfterSavings,
    // `ok` = a automação roda inteira, do jeito que está configurada.
    ok: !warnings.some((w) => w.level === 'error'),
    warnings,
  };
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
    result.payments = await runAutoPayments(userId, monthId, config);
  }
  if (shouldSave) {
    result.savings = await runAutoSave(userId, monthId, {
      type: config.saveLeftoverType,
      value: config.saveLeftoverValue,
      bucketId: config.saveLeftoverBucketId,
      minimumBalance: config.minimumBalance,
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
  previewAutomations,
};
