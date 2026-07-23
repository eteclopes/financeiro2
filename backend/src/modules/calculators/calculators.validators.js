const { z } = require('zod');

const money = z.coerce.number().finite().min(0).max(1_000_000_000);
const positiveMoney = z.coerce.number().finite().positive().max(1_000_000_000);
const rate = z.coerce.number().finite().min(0).max(1000);
const ratePeriod = z.enum(['monthly', 'annual']).default('annual');

function requireRate(data, ctx, field = 'rate', legacyField = 'annualRate') {
  if (data[field] === undefined && data[legacyField] === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: 'Informe a taxa.' });
  }
}

const schemas = {
  compound: z.object({
    initialValue: money.default(0),
    monthlyContribution: money.default(0),
    rate: rate.optional(),
    annualRate: rate.optional(),
    ratePeriod,
    years: z.coerce.number().positive().max(100),
    inflationRate: rate.default(0),
  }).superRefine((data, ctx) => requireRate(data, ctx)),
  financing: z.object({
    assetValue: positiveMoney,
    downPayment: money.default(0),
    rate: rate.optional(),
    annualRate: rate.optional(),
    ratePeriod,
    months: z.coerce.number().int().min(1).max(600),
    system: z.enum(['price', 'sac']),
    extraFees: money.default(0),
  }).superRefine((data, ctx) => {
    requireRate(data, ctx);
    if (data.downPayment >= data.assetValue + data.extraFees) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Entrada inválida.', path: ['downPayment'] });
    }
  }),
  cashVsInstallments: z.object({
    cashPrice: positiveMoney,
    installmentTotal: positiveMoney,
    installments: z.coerce.number().int().min(1).max(120),
    investmentRate: rate.optional(),
    annualInvestmentRate: rate.optional(),
    investmentRatePeriod: ratePeriod,
    cashback: money.default(0),
  }).superRefine((data, ctx) => requireRate(data, ctx, 'investmentRate', 'annualInvestmentRate')),
  debtPayoff: z.object({
    balance: positiveMoney,
    rate: rate.optional(),
    annualRate: rate.optional(),
    ratePeriod,
    monthlyPayment: positiveMoney,
    extraMonthly: money.default(0),
  }).superRefine((data, ctx) => requireRate(data, ctx)),
  emergencyReserve: z.object({
    monthlyEssentialExpenses: positiveMoney,
    targetMonths: z.coerce.number().min(1).max(36),
    currentReserve: money.default(0),
    monthlyContribution: money.default(0),
  }),
};

module.exports = schemas;
