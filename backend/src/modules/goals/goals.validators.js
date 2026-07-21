const { z } = require('zod');

const createGoalSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório.').max(120),
  description: z.string().trim().max(255).optional(),
  targetValue: z.coerce.number().positive('Valor alvo deve ser maior que zero.'),
  targetDate: z.coerce.date().optional(),
});

const updateGoalSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(255).optional(),
  targetValue: z.coerce.number().positive().optional(),
  targetDate: z.coerce.date().optional(),
});

const contributeSchema = z.object({
  monthId: z.coerce.bigint(),
  value: z.coerce.number().positive('Valor do aporte deve ser maior que zero.'),
  date: z.coerce.date(),
});

const cancelGoalSchema = z.object({
  refundContributions: z.boolean().default(false),
  monthId: z.coerce.bigint().optional(), // mês em que a devolução deve ser registrada (default: mês atual)
});

module.exports = { createGoalSchema, updateGoalSchema, contributeSchema, cancelGoalSchema };
