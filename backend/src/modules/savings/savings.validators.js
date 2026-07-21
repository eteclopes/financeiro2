const { z } = require('zod');

const savingsMovementSchema = z.object({
  value: z.coerce.number().positive('Valor deve ser maior que zero.'),
  date: z.coerce.date(),
  observation: z.string().trim().max(255).optional(),
  // Só é usado (e faz sentido) em depósitos — retirada ignora este campo.
  // 'balance': o valor sai do saldo disponível agora (padrão, comportamento
  // de sempre). 'external': já estava guardado fora do app, só passa a ser
  // rastreado aqui, sem sair de lugar nenhum.
  origin: z.enum(['balance', 'external']).default('balance'),
});

module.exports = { savingsMovementSchema };
