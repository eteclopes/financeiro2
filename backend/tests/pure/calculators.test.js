const {
  calculateCompoundInterest,
  calculateFinancing,
  convertRate,
  calculateCashVsInstallments,
  calculateDebtPayoff,
  calculateEmergencyReserve,
} = require('../../src/modules/calculators/calculators.service');

describe('Calculadoras Pro', () => {
  test('juros compostos sem taxa soma apenas os aportes', () => {
    const result = calculateCompoundInterest({
      initialValue: 1000,
      monthlyContribution: 100,
      annualRate: 0,
      years: 1,
      inflationRate: 0,
    });
    expect(result.finalBalance).toBe(2200);
    expect(result.totalInterest).toBe(0);
    expect(result.evolution).toHaveLength(1);
  });

  test('financiamento Price com taxa zero divide igualmente', () => {
    const result = calculateFinancing({
      assetValue: 12000,
      downPayment: 0,
      annualRate: 0,
      months: 12,
      system: 'price',
      extraFees: 0,
    });
    expect(result.firstInstallment).toBe(1000);
    expect(result.totalInterest).toBe(0);
    expect(result.totalPaid).toBe(12000);
  });

  test('conversão mensal/anual é equivalente', () => {
    const annual = convertRate({ rate: 1, source: 'monthly' });
    const monthly = convertRate({ rate: annual.annualRate, source: 'annual' });
    expect(annual.annualRate).toBeCloseTo(12.68, 2);
    expect(monthly.monthlyRate).toBeCloseTo(1, 2);
  });

  test('à vista ganha quando é claramente mais barato', () => {
    const result = calculateCashVsInstallments({
      cashPrice: 900,
      installmentTotal: 1200,
      installments: 12,
      annualInvestmentRate: 0,
      cashback: 0,
    });
    expect(result.recommendation).toBe('cash');
    expect(result.advantage).toBe(300);
  });

  test('aporte extra reduz prazo e juros da dívida', () => {
    const result = calculateDebtPayoff({
      balance: 10000,
      annualRate: 24,
      monthlyPayment: 600,
      extraMonthly: 300,
    });
    expect(result.monthsSaved).toBeGreaterThan(0);
    expect(result.interestSaved).toBeGreaterThan(0);
  });

  test('reserva informa cobertura e prazo', () => {
    const result = calculateEmergencyReserve({
      monthlyEssentialExpenses: 3000,
      targetMonths: 6,
      currentReserve: 6000,
      monthlyContribution: 1000,
    });
    expect(result.targetReserve).toBe(18000);
    expect(result.coverageMonths).toBe(2);
    expect(result.monthsToReach).toBe(12);
  });
});
