const AppError = require('../../utils/AppError');
const { round2 } = require('../../utils/math');

function equivalentMonthlyRate(ratePercent, ratePeriod = 'annual') {
  const value = Number(ratePercent) / 100;
  if (ratePeriod === 'monthly') return value;
  return Math.pow(1 + value, 1 / 12) - 1;
}

function resolveRate(data, preferredField = 'rate') {
  const value = data[preferredField] ?? data.annualRate ?? data.annualInvestmentRate ?? 0;
  return {
    value: Number(value),
    period: data.ratePeriod ?? data.investmentRatePeriod ?? 'annual',
  };
}

function calculateCompoundInterest({ initialValue, monthlyContribution, inflationRate = 0, years, ...rateData }) {
  const months = Math.round(Number(years) * 12);
  const { value: enteredRate, period: ratePeriod } = resolveRate(rateData);
  const monthlyRate = equivalentMonthlyRate(enteredRate, ratePeriod);
  let balance = Number(initialValue);
  let invested = Number(initialValue);
  const evolution = [];

  for (let month = 1; month <= months; month += 1) {
    balance = balance * (1 + monthlyRate) + Number(monthlyContribution);
    invested += Number(monthlyContribution);
    if (month % 12 === 0 || month === months) {
      evolution.push({ month, year: round2(month / 12), balance: round2(balance), invested: round2(invested) });
    }
  }

  const inflationFactor = Math.pow(1 + Number(inflationRate) / 100, Number(years));
  return {
    finalBalance: round2(balance),
    totalInvested: round2(invested),
    totalInterest: round2(balance - invested),
    realBalance: round2(balance / inflationFactor),
    enteredRate: round2(enteredRate),
    ratePeriod,
    monthlyEquivalentRate: round2(monthlyRate * 100),
    evolution,
  };
}

function calculateFinancing({ assetValue, downPayment, months, system, extraFees = 0, ...rateData }) {
  const financed = Number(assetValue) - Number(downPayment) + Number(extraFees);
  if (financed <= 0) throw new AppError('O valor financiado precisa ser maior que zero.', 422, 'VALIDATION_ERROR');
  const { value: enteredRate, period: ratePeriod } = resolveRate(rateData);
  const rate = equivalentMonthlyRate(enteredRate, ratePeriod);
  let balance = financed;
  let totalInterest = 0;
  let totalPaid = 0;
  const schedule = [];
  const fixedAmortization = financed / Number(months);
  const pricePayment = rate === 0
    ? financed / Number(months)
    : financed * (rate * Math.pow(1 + rate, Number(months))) / (Math.pow(1 + rate, Number(months)) - 1);

  for (let installment = 1; installment <= Number(months); installment += 1) {
    const interest = balance * rate;
    const amortization = system === 'sac' ? Math.min(fixedAmortization, balance) : Math.min(pricePayment - interest, balance);
    const payment = amortization + interest;
    balance = Math.max(balance - amortization, 0);
    totalInterest += interest;
    totalPaid += payment;
    if (installment <= 12 || installment === Number(months) || installment % 12 === 0) {
      schedule.push({ installment, payment: round2(payment), interest: round2(interest), amortization: round2(amortization), balance: round2(balance) });
    }
  }

  return {
    financedAmount: round2(financed),
    firstInstallment: round2(schedule[0]?.payment ?? 0),
    lastInstallment: round2(schedule[schedule.length - 1]?.payment ?? 0),
    totalInterest: round2(totalInterest),
    totalPaid: round2(totalPaid + Number(downPayment)),
    enteredRate: round2(enteredRate),
    ratePeriod,
    monthlyEquivalentRate: round2(rate * 100),
    schedule,
  };
}

/**
 * CUSTO DO PARCELAMENTO (juros embutidos / CET mensal).
 *
 * Em vez de um comparativo vago "à vista x parcelado", revela a TAXA DE
 * JUROS escondida num parcelamento "sem juros". Resolve, por bisseção, a
 * taxa mensal i que iguala o preço à vista ao valor presente das parcelas:
 *
 *   cashPrice = sum_{k=1..n} ( parcela / (1+i)^k )
 *
 * Se as parcelas somam o mesmo que o à vista e i≈0, é juros zero de
 * verdade. Se o parcelado é mais caro, i sai positivo — é o custo real do
 * "sem juros". Também compara com aplicar o dinheiro (investmentRate):
 * vale parcelar se o CET for menor que o rendimento do investimento.
 */
function calculateInstallmentCost({ cashPrice, installmentValue, installments, ...rateData }) {
  const price = Number(cashPrice);
  const payment = Number(installmentValue);
  const n = Number(installments);
  const nominalTotal = round2(payment * n);

  // Valor presente das parcelas a uma taxa i (parcelas postecipadas).
  const pvAt = (i) => {
    if (Math.abs(i) < 1e-12) return payment * n;
    return payment * (1 - Math.pow(1 + i, -n)) / i;
  };

  let monthlyRate = 0;
  if (nominalTotal <= price + 0.005) {
    // Parcelado não é mais caro que o à vista: não há juros embutido.
    monthlyRate = 0;
  } else {
    // Bisseção: PV decresce com i. Procuramos i tal que pvAt(i) = price.
    let low = 0;
    let high = 5; // 500% a.m. — teto folgado
    for (let iter = 0; iter < 200; iter += 1) {
      const mid = (low + high) / 2;
      if (pvAt(mid) > price) low = mid; else high = mid;
    }
    monthlyRate = (low + high) / 2;
  }

  const annualRate = Math.pow(1 + monthlyRate, 12) - 1;
  const embeddedInterest = round2(nominalTotal - price);

  // Comparação com investir o valor à vista enquanto paga as parcelas.
  const { value: enteredRate, period: ratePeriod } = resolveRate(rateData, 'investmentRate');
  const investMonthly = equivalentMonthlyRate(enteredRate, ratePeriod);
  // Vale parcelar (e investir o dinheiro) se o rendimento supera o CET.
  const worthInstallment = nominalTotal <= price + 0.005 || investMonthly > monthlyRate + 1e-9;

  return {
    cashPrice: round2(price),
    installmentValue: round2(payment),
    installments: n,
    nominalTotal,
    embeddedInterest,                                   // quanto a mais paga no parcelado
    isInterestFree: embeddedInterest <= 0.005,
    monthlyInterestRate: round2(monthlyRate * 100),     // CET mensal (%)
    annualInterestRate: round2(annualRate * 100),       // CET anual (%)
    investmentMonthlyRate: round2(investMonthly * 100),
    recommendation: worthInstallment ? 'installments' : 'cash',
    enteredRate: round2(enteredRate),
    ratePeriod,
  };
}

/**
 * ANTECIPAR A DÍVIDA OU INVESTIR?
 *
 * Decide onde um dinheiro extra rende mais: abater a dívida (economiza os
 * juros dela) ou aplicar (rende a taxa do investimento). A comparação é
 * feita na MESMA base mensal composta.
 *
 * Regra simples e correta: se a taxa da dívida > taxa do investimento,
 * quitar/antecipar rende mais (cada real abatido "rende" a taxa da dívida,
 * livre de risco). Caso contrário, investir tende a valer mais.
 *
 * Também projeta, para o `extraAmount` informado, o ganho de cada caminho
 * ao longo de `horizonMonths`, para o usuário ver a diferença em dinheiro.
 */
function calculatePayoffVsInvest({ debtBalance, debtRate, debtRatePeriod = 'monthly', investmentRate, investmentRatePeriod = 'annual', extraAmount, horizonMonths = 12 }) {
  const balance = Number(debtBalance);
  const extra = Number(extraAmount);
  const months = Math.round(Number(horizonMonths));

  const debtMonthly = equivalentMonthlyRate(Number(debtRate), debtRatePeriod);
  const investMonthly = equivalentMonthlyRate(Number(investmentRate), investmentRatePeriod);

  const applied = Math.min(extra, balance);

  // Economia de juros ao abater `applied` da dívida por `months` meses
  // (juros que deixariam de incidir sobre o valor abatido).
  const interestAvoided = round2(applied * (Math.pow(1 + debtMonthly, months) - 1));

  // Rendimento de investir o MESMO valor pelo mesmo período.
  const investmentEarnings = round2(extra * (Math.pow(1 + investMonthly, months) - 1));

  const advantage = round2(Math.abs(interestAvoided - investmentEarnings));
  const recommendation = debtMonthly > investMonthly ? 'payoff' : 'invest';

  return {
    recommendation,
    debtMonthlyRate: round2(debtMonthly * 100),
    investmentMonthlyRate: round2(investMonthly * 100),
    appliedToDebt: round2(applied),
    interestAvoided,                 // ganho de abater a dívida
    investmentEarnings,              // ganho de investir
    advantage,                       // diferença em dinheiro no horizonte
    horizonMonths: months,
    remainingDebtAfterPayoff: round2(Math.max(balance - extra, 0)),
  };
}

/**
 * META POR PRAZO — quanto guardar por mês para chegar a um valor até uma
 * data. Serve para qualquer objetivo (viagem, entrada, reserva de
 * emergência...). Com rendimento, resolve o aporte PMT da série futura:
 *
 *   FV = presente*(1+i)^n + PMT * ((1+i)^n - 1) / i
 *   =>  PMT = (FV - presente*(1+i)^n) * i / ((1+i)^n - 1)
 *
 * Sem rendimento (i=0), é uma divisão simples do que falta pelos meses.
 */
function calculateGoalPlan({ targetAmount, currentAmount = 0, months, ...rateData }) {
  const target = Number(targetAmount);
  const present = Number(currentAmount);
  const n = Math.round(Number(months));

  if (present >= target) {
    return {
      targetAmount: round2(target),
      currentAmount: round2(present),
      months: n,
      alreadyReached: true,
      monthlyContribution: 0,
      totalContributed: 0,
      interestEarned: 0,
    };
  }

  const { value: enteredRate, period: ratePeriod } = resolveRate(rateData, 'investmentRate');
  const i = equivalentMonthlyRate(enteredRate, ratePeriod);

  let pmt;
  if (Math.abs(i) < 1e-12) {
    pmt = (target - present) / n;
  } else {
    const growth = Math.pow(1 + i, n);
    pmt = (target - present * growth) * i / (growth - 1);
  }
  pmt = Math.max(round2(pmt), 0);

  const totalContributed = round2(pmt * n);
  const interestEarned = round2(target - present - totalContributed);

  return {
    targetAmount: round2(target),
    currentAmount: round2(present),
    months: n,
    alreadyReached: false,
    monthlyContribution: pmt,             // quanto guardar por mês
    totalContributed,                     // soma dos aportes
    interestEarned: Math.max(interestEarned, 0), // quanto o rendimento ajudou
    enteredRate: round2(enteredRate),
    ratePeriod,
    monthlyEquivalentRate: round2(i * 100),
  };
}

module.exports = {
  equivalentMonthlyRate,
  calculateCompoundInterest,
  calculateFinancing,
  calculateInstallmentCost,
  calculatePayoffVsInvest,
  calculateGoalPlan,
};
