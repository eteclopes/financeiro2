const prisma = require('../../config/prisma');
const monthsService = require('../months/months.service');
const debtsService = require('../debts/debts.service');
const { addMonths } = require('../../utils/monthMath');
const { round2 } = require('../../utils/math');

/**
 * Simula (SEM gravar nada no banco) o cronograma de parcelas de cada
 * dívida ativa para os próximos meses, reaproveitando a mesma fórmula
 * usada de verdade no fechamento mensal (debtsService.computeInstallmentValue)
 * — garante que a projeção bate com o que o sistema realmente vai cobrar
 * quando o mês chegar.
 */
/**
 * Cronograma de UMA dívida específica, alinhado aos meses de calendário
 * reais em `months` (array de `{ month, year }`, na mesma ordem/tamanho
 * que o resultado), com saldo devedor inicial sobrescrevível — é o que
 * permite ao simulador "E Se" testar "e se eu antecipasse R$X" sem
 * duplicar a fórmula de cálculo de parcela.
 *
 * IMPORTANTE (correção de alinhamento): o mês inicial de uma projeção
 * (índice 0) quase sempre JÁ TEM sua parcela gerada de verdade — ela
 * nasce no fechamento do mês anterior (ou na criação da dívida, se for
 * o mês de origem). Antes, esta função ignorava isso e simplesmente
 * "adivinhava" a parcela seguinte pela fórmula a partir de uma contagem
 * global (`expense.count`), o que empurrava o cronograma inteiro um mês
 * para frente: o índice 0 mostrava o valor da parcela do mês SEGUINTE, e
 * a última parcela real (normalmente maior, pois absorve o resíduo do
 * saldo) acabava descartada do horizonte por sobrar um índice depois do
 * fim do laço. Agora, para cada mês da janela, se já existe uma parcela
 * real gerada (Expense com esse debtId, nesse mês), usamos o valor real
 * gravado — nunca recalculado — e só passamos a "projetar" pela fórmula a
 * partir do primeiro mês que ainda não tem parcela gerada. O saldo
 * (`remaining`) é abatido tanto nos meses reais quanto nos projetados,
 * pela mesma suposição de "pagamento em dia" que já valia antes — senão
 * o mês real ficaria contado em dobro (uma vez como parcela já gerada,
 * outra vez "escondido" dentro do saldo repassado adiante).
 */
async function getSingleDebtSchedule(debt, months, remainingBalanceOverride = null) {
  const schedule = new Array(months.length).fill(0);

  const existingInstallments = await prisma.expense.findMany({
    where: { debtId: debt.id },
    select: { value: true, month: { select: { month: true, year: true } } },
  });
  const realValueByMonthKey = new Map(
    existingInstallments.map((e) => [`${e.month.month}-${e.month.year}`, Number(e.value)])
  );

  let remaining = remainingBalanceOverride ?? Number(debt.remainingBalance);
  let generated = existingInstallments.length;
  // Começa do ajuste pendente REAL da dívida (resultado do último
  // pagamento a mais/a menos já feito) — mesmo quando `remainingBalanceOverride`
  // é usado (simulação de antecipação no "E Se"), porque o ajuste pendente
  // é um fato já consumado, independente do saldo hipotético que está
  // sendo testado.
  let carryOver = Number(debt.pendingCarryOver ?? 0);

  for (let i = 0; i < months.length; i += 1) {
    const key = `${months[i].month}-${months[i].year}`;
    const realValue = realValueByMonthKey.get(key);

    if (realValue !== undefined) {
      schedule[i] = round2(realValue);
      remaining = round2(remaining - realValue);
      continue;
    }

    const installmentsRemaining = debt.installmentsCount - generated;
    if (installmentsRemaining <= 0 || remaining <= 0.009) break;
    const value = debtsService.computeInstallmentValue(remaining, installmentsRemaining, Number(debt.installmentValue), carryOver);
    schedule[i] = round2(value);
    // Sobra do ajuste que não coube nesta parcela (clampada pelo saldo ou
    // pelo mínimo zero) continua valendo para a parcela seguinte — mesma
    // lógica usada de verdade em debts.service.generateNextInstallment.
    carryOver = round2((Number(debt.installmentValue) + carryOver) - value);
    remaining = round2(remaining - value);
    generated += 1;
  }

  return schedule;
}

/**
 * Soma o cronograma de TODAS as dívidas ativas do usuário, mês a mês,
 * alinhado a `months` (mesma lista de `{ month, year }` usada no resto da
 * projeção — ver getProjectionComponents).
 */
async function getDebtInstallmentSchedule(userId, months) {
  const debts = await prisma.debt.findMany({ where: { userId, status: 'active' } });
  const schedule = new Array(months.length).fill(0);

  // Antes: `for (const debt of debts) { await getSingleDebtSchedule(...) }`
  // rodava uma dívida de cada vez, em série — com N dívidas ativas, N
  // round-trips ao banco um atrás do outro. Mesmo cálculo, mesmas queries,
  // agora disparadas em paralelo (Promise.all) em vez de esperar uma
  // terminar para começar a próxima.
  const perDebtSchedules = await Promise.all(debts.map((debt) => getSingleDebtSchedule(debt, months)));
  for (const debtSchedule of perDebtSchedules) {
    for (let i = 0; i < months.length; i += 1) {
      schedule[i] = round2(schedule[i] + debtSchedule[i]);
    }
  }

  return schedule;
}

/**
 * Parcelas de cartão futuras já existem como `expenses` reais (toda a
 * compra parcelada gera todas as parcelas de uma vez — ver
 * cardPurchases.service.js), então aqui é só somar o que já está
 * agendado, sem simular nada.
 */
async function getCardInstallmentsForMonth(userId, refMonth, refYear) {
  const month = await prisma.month.findUnique({
    where: { userId_month_year: { userId, month: refMonth, year: refYear } },
  });
  if (!month) return 0;

  const agg = await prisma.expense.aggregate({
    where: { userId, monthId: month.id, type: 'card', deletedAt: null },
    _sum: { value: true },
  });
  return Number(agg._sum.value ?? 0);
}

async function getActiveRecurringTotals(userId) {
  const [incomeAgg, fixedAgg] = await Promise.all([
    prisma.incomeTemplate.aggregate({ where: { userId, active: true }, _sum: { value: true } }),
    prisma.fixedExpenseTemplate.aggregate({ where: { userId, active: true }, _sum: { value: true } }),
  ]);
  return {
    income: Number(incomeAgg._sum.value ?? 0),
    fixedExpenses: Number(fixedAgg._sum.value ?? 0),
  };
}

/**
 * Componentes brutos da projeção, antes de "mesclar" em net mensal —
 * reaproveitados pelo simulador "E Se" para aplicar cenários (quitar
 * dívida, aumentar renda etc.) em cima dos mesmos números reais.
 */
async function getProjectionComponents(userId, startMonthId, monthsAhead) {
  const startMonth = await monthsService.getMonthOrThrow(userId, startMonthId);

  const months = [];
  for (let i = 0; i < monthsAhead; i += 1) {
    months.push(addMonths(startMonth.month, startMonth.year, i));
  }

  // Antes: `for (...) { cardSchedule.push(await getCardInstallmentsForMonth(...)) }`
  // — um round-trip ao banco por mês, em série (até 24 seguidos, já que
  // monthsAhead vai até 24). `addMonths` é puro/síncrono, então dá para
  // montar `months` inteiro antes e disparar as buscas de cartão em
  // paralelo, na mesma ordem (Promise.all preserva a ordem do array).
  const [debtSchedule, recurring, cardSchedule] = await Promise.all([
    getDebtInstallmentSchedule(userId, months),
    getActiveRecurringTotals(userId),
    Promise.all(months.map((ref) => getCardInstallmentsForMonth(userId, ref.month, ref.year))),
  ]);

  return { startMonth, months, recurringIncome: recurring.income, fixedExpenses: recurring.fixedExpenses, debtSchedule, cardSchedule };
}

/**
 * Projeção mês a mês a partir de `startMonthId`. `cumulativeNet` é a soma
 * acumulada do saldo líquido projetado a partir de zero — quem chama soma
 * o saldo atual real (já calculado em dashboard.service.js) por cima, se
 * quiser uma trajetória absoluta em vez de relativa.
 */
async function projectMonths(userId, startMonthId, monthsAhead) {
  const components = await getProjectionComponents(userId, startMonthId, monthsAhead);
  return mergeComponentsIntoSeries(components);
}

function mergeComponentsIntoSeries({ months, recurringIncome, fixedExpenses, debtSchedule, cardSchedule }) {
  const results = [];
  let cumulative = 0;

  for (let i = 0; i < months.length; i += 1) {
    const debtInstallments = debtSchedule[i] ?? 0;
    const cardInstallments = cardSchedule[i] ?? 0;
    const totalExpenses = round2(fixedExpenses + debtInstallments + cardInstallments);
    const netProjected = round2(recurringIncome - totalExpenses);
    cumulative = round2(cumulative + netProjected);

    results.push({
      month: months[i].month,
      year: months[i].year,
      projectedIncome: round2(recurringIncome),
      projectedFixedExpenses: round2(fixedExpenses),
      projectedDebtInstallments: round2(debtInstallments),
      projectedCardInstallments: round2(cardInstallments),
      totalExpenses,
      netProjected,
      cumulativeNet: cumulative,
    });
  }

  return results;
}

module.exports = {
  projectMonths,
  getProjectionComponents,
  mergeComponentsIntoSeries,
  getDebtInstallmentSchedule,
  getSingleDebtSchedule,
  getActiveRecurringTotals,
  getCardInstallmentsForMonth,
};
