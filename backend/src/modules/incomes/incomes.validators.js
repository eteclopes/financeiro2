const { z } = require('zod');

const PAYMENT_METHODS = ['cash', 'pix', 'debit', 'credit', 'transfer'];

const createIncomeSchema = z.object({
  monthId: z.coerce.bigint(),
  description: z.string().trim().min(1, 'Descrição é obrigatória.').max(160),
  value: z.coerce.number().positive('Valor deve ser maior que zero.'),
  categoryId: z.coerce.bigint(),
  paymentMethod: z.enum(PAYMENT_METHODS),
  origin: z.enum(['digital', 'physical']).default('digital'),
  date: z.coerce.date(),
  observation: z.string().trim().max(255).optional(),
  recurring: z.boolean().default(false),
});

const updateIncomeSchema = z.object({
  description: z.string().trim().min(1).max(160).optional(),
  value: z.coerce.number().positive().optional(),
  categoryId: z.coerce.bigint().optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  origin: z.enum(['digital', 'physical']).optional(),
  date: z.coerce.date().optional(),
  observation: z.string().trim().max(255).optional(),
});

module.exports = { createIncomeSchema, updateIncomeSchema };
