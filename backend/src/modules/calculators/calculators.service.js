const AppError = require('../../utils/AppError');
const { round2 } = require('../../utils/math');

function equivalentMonthlyRate(annualPercent) {
  return Math.pow(1 + Number(annualPercent) / 100, 1 / 12) - 1;
}

function calculateCompoundInterest({ initialValue, monthlyContribution, annualRate, years, inflationRate = 0 }) {
  const months = Math.round(Number(years) * 12);
  const monthlyRate = equivalentMonthlyRate(annualRate);
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
    monthlyEquivalentRate: round2(monthlyRate * 100),
    evolution,
  };
}

function calculateFinancing({ assetValue, downPayment, annualRate, months, system, extraFees = 0 }) {
  const financed = Number(assetValue) - Number(downPayment) + Number(extraFees);
  if (financed <= 0) throw new AppError('O valor financiado precisa ser maior que zero.', 422, 'VALIDATION_ERROR');
  const rate = equivalentMonthlyRate(annualRate);
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
    monthlyEquivalentRate: round2(rate * 100),
    schedule,
  };
}

function convertRate({ rate, source }) {
  const value = Number(rate) / 100;
  if (source === 'monthly') {
    return { monthlyRate: round2(Number(rate)), annualRate: round2((Math.pow(1 + value, 12) - 1) * 100) };
  }
  return { annualRate: round2(Number(rate)), monthlyRate: round2((Math.pow(1 + value, 1 / 12) - 1) * 100) };
}

function calculateCashVsInstallments({ cashPrice, installmentTotal, installments, annualInvestmentRate = 0, cashback = 0 }) {
  const monthlyRate = equivalentMonthlyRate(annualInvestmentRate);
  const payment = Number(installmentTotal) / Number(installments);
  let presentValue = 0;
  for (let i = 1; i <= Number(installments); i += 1) {
    presentValue += payment / Math.pow(1 + monthlyRate, i);
  }
  const adjustedInstallmentCost = presentValue - Number(cashback);
  const difference = Math.abs(Number(cashPrice) - adjustedInstallmentCost);
  const recommendation = Number(cashPrice) <= adjustedInstallmentCost ? 'cash' : 'installments';
  return {
    recommendation,
    cashCost: round2(Number(cashPrice)),
    installmentNominalCost: round2(Number(installmentTotal)),
    installmentPresentValue: round2(presentValue),
    adjustedInstallmentCost: round2(adjustedInstallmentCost),
    advantage: round2(difference),
    monthlyEquivalentRate: round2(monthlyRate * 100),
  };
}

function amortizeDebt(balanceInput, annualRate, monthlyPayment, maxMonths = 600) {
  const rate = equivalentMonthlyRate(annualRate);
  let balance = Number(balanceInput);
  let interestPaid = 0;
  let months = 0;
  while (balance > 0.005 && months < maxMonths) {
    const interest = balance * rate;
    if (Number(monthlyPayment) <= interest + 0.005) return { possible: false };
    const payment = Math.min(Number(monthlyPayment), balance + interest);
    balance = Math.max(balance + interest - payment, 0);
    interestPaid += interest;
    months += 1;
  }
  return { possible: balance <= 0.005, months, interestPaid: round2(interestPaid), totalPaid: round2(Number(balanceInput) + interestPaid) };
}

function calculateDebtPayoff({ balance, annualRate, monthlyPayment, extraMonthly = 0 }) {
  const baseline = amortizeDebt(balance, annualRate, monthlyPayment);
  const accelerated = amortizeDebt(balance, annualRate, Number(monthlyPayment) + Number(extraMonthly));
  if (!baseline.possible || !accelerated.possible) {
    throw new AppError('A parcela não cobre os juros mensais da dívida.', 422, 'PAYMENT_TOO_LOW');
  }
  return {
    baseline,
    accelerated,
    monthsSaved: Math.max(baseline.months - accelerated.months, 0),
    interestSaved: round2(Math.max(baseline.interestPaid - accelerated.interestPaid, 0)),
  };
}

function calculateEmergencyReserve({ monthlyEssentialExpenses, targetMonths, currentReserve = 0, monthlyContribution = 0 }) {
  const target = Number(monthlyEssentialExpenses) * Number(targetMonths);
  const missing = Math.max(target - Number(currentReserve), 0);
  const monthsToReach = missing === 0 ? 0 : Number(monthlyContribution) > 0 ? Math.ceil(missing / Number(monthlyContribution)) : null;
  return {
    targetReserve: round2(target),
    currentReserve: round2(Number(currentReserve)),
    missingAmount: round2(missing),
    coverageMonths: Number(monthlyEssentialExpenses) > 0 ? round2(Number(currentReserve) / Number(monthlyEssentialExpenses)) : 0,
    monthsToReach,
  };
}

module.exports = {
  equivalentMonthlyRate,
  calculateCompoundInterest,
  calculateFinancing,
  convertRate,
  calculateCashVsInstallments,
  calculateDebtPayoff,
  calculateEmergencyReserve,
};
