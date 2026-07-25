const {
  calculateCompoundInterest,
  calculateFinancing,
  calculateInstallmentCost,
  calculatePayoffVsInvest,
  calculateGoalPlan,
} = require('../../src/modules/calculators/calculators.service');

describe('Calculadoras Pro — juros compostos e financiamento (mantidas)', () => {
  test('juros compostos sem taxa soma apenas os aportes', () => {
    const result = calculateCompoundInterest({
      initialValue: 1000, monthlyContribution: 100, rate: 0, ratePeriod: 'annual', years: 1, inflationRate: 0,
    });
    expect(result.finalBalance).toBe(2200);
    expect(result.totalInterest).toBe(0);
    expect(result.evolution).toHaveLength(1);
  });

  test('taxa mensal é usada diretamente sem ser convertida como anual', () => {
    const result = calculateCompoundInterest({
      initialValue: 1000, monthlyContribution: 0, rate: 1, ratePeriod: 'monthly', years: 1, inflationRate: 0,
    });
    expect(result.finalBalance).toBeCloseTo(1126.83, 2);
    expect(result.monthlyEquivalentRate).toBe(1);
  });

  test('financiamento Price com taxa zero divide igualmente', () => {
    const result = calculateFinancing({
      assetValue: 12000, downPayment: 0, rate: 0, ratePeriod: 'monthly', months: 12, system: 'price', extraFees: 0,
    });
    expect(result.firstInstallment).toBe(1000);
    expect(result.totalInterest).toBe(0);
    expect(result.totalPaid).toBe(12000);
  });

  test('financiamento aceita taxa mensal e anual equivalentes', () => {
    const monthly = calculateFinancing({
      assetValue: 10000, downPayment: 0, rate: 1, ratePeriod: 'monthly', months: 12, system: 'price', extraFees: 0,
    });
    const annual = calculateFinancing({
      assetValue: 10000, downPayment: 0, rate: 12.682503, ratePeriod: 'annual', months: 12, system: 'price', extraFees: 0,
    });
    expect(monthly.firstInstallment).toBeCloseTo(annual.firstInstallment, 1);
  });
});

describe('Custo do parcelamento (CET / juros embutidos)', () => {
  test('parcelas que somam o mesmo que o à vista => juros zero', () => {
    const r = calculateInstallmentCost({ cashPrice: 1200, installmentValue: 100, installments: 12 });
    expect(r.isInterestFree).toBe(true);
    expect(r.monthlyInterestRate).toBe(0);
    expect(r.embeddedInterest).toBe(0);
  });

  test('parcelado mais caro revela a taxa mensal embutida (positiva)', () => {
    // 12x de 100 = 1200, mas à vista custa 1000 => há juros embutido.
    const r = calculateInstallmentCost({ cashPrice: 1000, installmentValue: 100, installments: 12 });
    expect(r.embeddedInterest).toBe(200);
    expect(r.monthlyInterestRate).toBeGreaterThan(0);
    // Confere por definição: o VP das parcelas ao CET deve bater com o à vista.
    const i = r.monthlyInterestRate / 100;
    const pv = 100 * (1 - Math.pow(1 + i, -12)) / i;
    expect(pv).toBeCloseTo(1000, 0);
  });

  test('CET conhecido é recuperado: 1% a.m. em 12x', () => {
    // Parcela de uma dívida de 1000 a 1% a.m. em 12x (Price):
    const i = 0.01;
    const pmt = 1000 * (i * Math.pow(1 + i, 12)) / (Math.pow(1 + i, 12) - 1);
    const r = calculateInstallmentCost({ cashPrice: 1000, installmentValue: pmt, installments: 12 });
    expect(r.monthlyInterestRate).toBeCloseTo(1, 1);
  });

  test('vale parcelar quando o investimento rende mais que o CET', () => {
    // à vista 1000, 12x de 100 (juros ~2.9% a.m.), investindo a 2% a.m. => à vista;
    // investindo a 5% a.m. => parcelar.
    const semVantagem = calculateInstallmentCost({ cashPrice: 1000, installmentValue: 100, installments: 12, investmentRate: 2, investmentRatePeriod: 'monthly' });
    expect(semVantagem.recommendation).toBe('cash');
    const comVantagem = calculateInstallmentCost({ cashPrice: 1000, installmentValue: 100, installments: 12, investmentRate: 5, investmentRatePeriod: 'monthly' });
    expect(comVantagem.recommendation).toBe('installments');
  });
});

describe('Antecipar a dívida ou investir?', () => {
  test('dívida mais cara que o investimento => recomenda quitar', () => {
    const r = calculatePayoffVsInvest({
      debtBalance: 5000, debtRate: 3, debtRatePeriod: 'monthly',
      investmentRate: 1, investmentRatePeriod: 'monthly',
      extraAmount: 1000, horizonMonths: 12,
    });
    expect(r.recommendation).toBe('payoff');
    expect(r.interestAvoided).toBeGreaterThan(r.investmentEarnings);
  });

  test('investimento mais rentável que a dívida => recomenda investir', () => {
    const r = calculatePayoffVsInvest({
      debtBalance: 5000, debtRate: 0.5, debtRatePeriod: 'monthly',
      investmentRate: 2, investmentRatePeriod: 'monthly',
      extraAmount: 1000, horizonMonths: 12,
    });
    expect(r.recommendation).toBe('invest');
    expect(r.investmentEarnings).toBeGreaterThan(r.interestAvoided);
  });

  test('valor extra maior que a dívida abate no máximo o saldo', () => {
    const r = calculatePayoffVsInvest({
      debtBalance: 800, debtRate: 2, debtRatePeriod: 'monthly',
      investmentRate: 1, investmentRatePeriod: 'monthly',
      extraAmount: 1000, horizonMonths: 6,
    });
    expect(r.appliedToDebt).toBe(800);
    expect(r.remainingDebtAfterPayoff).toBe(0);
  });
});

describe('Meta por prazo (quanto guardar por mês)', () => {
  test('sem rendimento, divide o que falta pelos meses', () => {
    const r = calculateGoalPlan({ targetAmount: 1200, currentAmount: 0, months: 12 });
    expect(r.monthlyContribution).toBe(100);
    expect(r.totalContributed).toBe(1200);
    expect(r.interestEarned).toBe(0);
  });

  test('considera o valor que já tem hoje', () => {
    const r = calculateGoalPlan({ targetAmount: 1200, currentAmount: 600, months: 6 });
    expect(r.monthlyContribution).toBe(100);
  });

  test('com rendimento, exige aporte mensal menor que sem rendimento', () => {
    const semJuros = calculateGoalPlan({ targetAmount: 12000, currentAmount: 0, months: 12 });
    const comJuros = calculateGoalPlan({ targetAmount: 12000, currentAmount: 0, months: 12, investmentRate: 12, investmentRatePeriod: 'annual' });
    expect(comJuros.monthlyContribution).toBeLessThan(semJuros.monthlyContribution);
    expect(comJuros.interestEarned).toBeGreaterThan(0);
  });

  test('meta já alcançada não pede aporte', () => {
    const r = calculateGoalPlan({ targetAmount: 1000, currentAmount: 1000, months: 10 });
    expect(r.alreadyReached).toBe(true);
    expect(r.monthlyContribution).toBe(0);
  });
});
