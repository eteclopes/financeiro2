const { z } = require('zod');

const PAYMENT_METHODS = ['cash', 'pix', 'debit', 'credit', 'transfer'];

const createVariableExpenseSchema = z.object({
  monthId: z.coerce.bigint(),
  description: z.string().trim().min(1, 'Descrição é obrigatória.').max(160),
  value: z.coerce.number().positive('Valor deve ser maior que zero.'),
  categoryId: z.coerce.bigint(),
  date: z.coerce.date(),
  paymentMethod: z.enum(PAYMENT_METHODS),
  cardId: z.coerce.bigint().optional(),
  // Despesa variável normalmente já representa um gasto que aconteceu
  // (ex.: compra no mercado) — por isso nasce paga por padrão. O usuário
  // pode desmarcar para registrar algo planejado e ainda não pago.
  paid: z.boolean().default(true),
  observation: z.string().trim().max(255).optional(),
}).refine((data) => data.paymentMethod !== 'credit' || data.cardId !== undefined, {
  message: 'Selecione o cartão quando a forma de pagamento for Cartão de Crédito.',
  path: ['cardId'],
});

const createFixedExpenseSchema = z.object({
  monthId: z.coerce.bigint(),
  description: z.string().trim().min(1, 'Descrição é obrigatória.').max(160),
  value: z.coerce.number().positive('Valor deve ser maior que zero.'),
  categoryId: z.coerce.bigint(),
  dueDay: z.coerce.number().int().min(1).max(31),
  paymentMethod: z.enum(PAYMENT_METHODS),
  cardId: z.coerce.bigint().optional(),
  observation: z.string().trim().max(255).optional(),
}).refine((data) => data.paymentMethod !== 'credit' || data.cardId !== undefined, {
  message: 'Selecione o cartão quando a forma de pagamento for Cartão de Crédito.',
  path: ['cardId'],
});

const updateExpenseSchema = z.object({
  description: z.string().trim().min(1).max(160).optional(),
  value: z.coerce.number().positive().optional(),
  categoryId: z.coerce.bigint().optional(),
  dueDate: z.coerce.date().optional(),
  observation: z.string().trim().max(255).optional(),
});

const payExpenseSchema = z.object({
  amount: z.coerce.number().positive('Valor pago deve ser maior que zero.'),
  paymentMethod: z.enum(PAYMENT_METHODS.filter((method) => method !== 'credit')),
});

module.exports = {
  createVariableExpenseSchema,
  createFixedExpenseSchema,
  updateExpenseSchema,
  payExpenseSchema,
  PAYMENT_METHODS,
};
