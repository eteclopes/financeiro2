const { z } = require('zod');

const PAYMENT_METHODS = ['cash', 'pix', 'debit', 'credit', 'transfer'];
const PERIODICITIES = ['monthly', 'annual', 'custom'];

const createSubscriptionSchema = z.object({
  monthId: z.coerce.bigint(),
  description: z.string().trim().min(1, 'Descrição é obrigatória.').max(160),
  categoryId: z.coerce.bigint(),
  value: z.coerce.number().positive('Valor deve ser maior que zero.'),
  paymentMethod: z.enum(PAYMENT_METHODS),
  cardId: z.coerce.bigint().optional(),
  periodicity: z.enum(PERIODICITIES).default('monthly'),
  customIntervalMonths: z.coerce.number().int().min(1).max(60).optional(),
  nextChargeDate: z.coerce.date(),
  endDate: z.coerce.date().optional(),
})
  .refine((data) => data.paymentMethod !== 'credit' || data.cardId !== undefined, {
    message: 'Selecione o cartão quando a forma de pagamento for Cartão de Crédito.',
    path: ['cardId'],
  })
  .refine((data) => data.periodicity !== 'custom' || data.customIntervalMonths !== undefined, {
    message: 'Informe o intervalo em meses para periodicidade customizada.',
    path: ['customIntervalMonths'],
  })
  .refine((data) => !data.endDate || data.endDate >= data.nextChargeDate, {
    message: 'A data de encerramento não pode ser antes da próxima cobrança.',
    path: ['endDate'],
  });

const updateSubscriptionSchema = z.object({
  description: z.string().trim().min(1).max(160).optional(),
  categoryId: z.coerce.bigint().optional(),
  value: z.coerce.number().positive().optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  cardId: z.coerce.bigint().optional(),
  periodicity: z.enum(PERIODICITIES).optional(),
  customIntervalMonths: z.coerce.number().int().min(1).max(60).optional(),
  endDate: z.coerce.date().nullable().optional(),
}).refine((data) => data.paymentMethod !== 'credit' || data.cardId !== undefined, {
  message: 'Selecione o cartão quando a forma de pagamento for Cartão de Crédito.',
  path: ['cardId'],
});

module.exports = { createSubscriptionSchema, updateSubscriptionSchema, PAYMENT_METHODS, PERIODICITIES };
