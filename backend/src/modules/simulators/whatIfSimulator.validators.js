const { z } = require('zod');

const scenarioInputMap = {
  pay_debt: z.object({ debtId: z.coerce.bigint() }),
  anticipate_installments: z.object({
    debtId: z.coerce.bigint(),
    amount: z.coerce.number().positive(),
  }),
  save_monthly: z.object({ amount: z.coerce.number().positive() }),
  reduce_category: z.object({ amount: z.coerce.number().positive() }),
  increase_income: z.object({ amount: z.coerce.number().positive() }),
};

const SCENARIO_TYPES = Object.keys(scenarioInputMap);

const previewSchema = z.object({
  monthId: z.coerce.bigint(),
  type: z.enum(SCENARIO_TYPES),
  input: z.record(z.any()),
  monthsAhead: z.coerce.number().int().min(1).max(24).default(12),
});

const saveSchema = z.object({
  monthId: z.coerce.bigint(),
  type: z.enum(SCENARIO_TYPES),
  name: z.string().trim().min(1, 'Nome é obrigatório.').max(160),
  input: z.record(z.any()),
  monthsAhead: z.coerce.number().int().min(1).max(24).default(12),
});

module.exports = { previewSchema, saveSchema, scenarioInputMap };
