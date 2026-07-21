const { z } = require('zod');

const purchaseSimulationSchema = z.object({
  monthId: z.coerce.bigint(),
  description: z.string().trim().min(1, 'Descrição é obrigatória.').max(160),
  value: z.coerce.number().positive('Valor deve ser maior que zero.'),
  installments: z.coerce.number().int().min(1).max(24).default(1),
  cardId: z.coerce.bigint().optional(),
});

module.exports = { purchaseSimulationSchema };
