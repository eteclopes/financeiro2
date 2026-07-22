const { z } = require('zod');

const money = z.coerce.number().finite().min(0).max(1_000_000_000);
const positiveMoney = z.coerce.number().finite().positive().max(1_000_000_000);
const rate = z.coerce.number().finite().min(0).max(1000);

const schemas = {
  compound: z.object({
    initialValue: money.default(0),
    monthlyContribution: money.default(0),
    annualRate: rate,
    years: z.coerce.number().positive().max(100),
    inflationRate: rate.default(0),
  }),
  financing: z.object({
    assetValue: positiveMoney,
    downPayment: money.default(0),
    annualRate: rate,
    months: z.coerce.number().int().min(1).max(600),
    system: z.enum(['price', 'sac']),
    extraFees: money.default(0),
  }).refine((data) => data.downPayment < data.assetValue + data.extraFees, { message: 'Entrada inválida.', path: ['downPayment'] }),
  rate: z.object({ rate, source: z.enum(['monthly', 'annual']) }),
  cashVsInstallments: z.object({
    cashPrice: positiveMoney,
    installmentTotal: positiveMoney,
    installments: z.coerce.number().int().min(1).max(120),
    annualInvestmentRate: rate.default(0),
    cashback: money.default(0),
  }),
  debtPayoff: z.object({
    balance: positiveMoney,
    annualRate: rate,
    monthlyPayment: positiveMoney,
    extraMonthly: money.default(0),
  }),
  emergencyReserve: z.object({
    monthlyEssentialExpenses: positiveMoney,
    targetMonths: z.coerce.number().min(1).max(36),
    currentReserve: money.default(0),
    monthlyContribution: money.default(0),
  }),
};

module.exports = schemas;
