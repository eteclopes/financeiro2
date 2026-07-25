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
  // Custo do parcelamento (CET / juros embutidos). A taxa de investimento é
  // opcional: se informada, compara "parcelar e investir" x "à vista".
  installmentCost: z.object({
    cashPrice: positiveMoney,
    installmentValue: positiveMoney,
    installments: z.coerce.number().int().min(1).max(120),
    investmentRate: rate.optional(),
    annualInvestmentRate: rate.optional(),
    investmentRatePeriod: ratePeriod,
  }),
  // Antecipar a dívida ou investir? Compara a taxa da dívida com a do
  // investimento sobre um valor extra, num horizonte de meses.
  payoffVsInvest: z.object({
    debtBalance: positiveMoney,
    debtRate: rate,
    debtRatePeriod: ratePeriod,
    investmentRate: rate,
    investmentRatePeriod: ratePeriod,
    extraAmount: positiveMoney,
    horizonMonths: z.coerce.number().int().min(1).max(600).default(12),
  }),
  // Meta por prazo: quanto guardar por mês para chegar a um valor até uma
  // data. Rendimento é opcional (0 = só divide o que falta pelos meses).
  goalPlan: z.object({
    targetAmount: positiveMoney,
    currentAmount: money.default(0),
    months: z.coerce.number().int().min(1).max(600),
    investmentRate: rate.optional(),
    annualInvestmentRate: rate.optional(),
    investmentRatePeriod: ratePeriod,
  }),
};

module.exports = schemas;
