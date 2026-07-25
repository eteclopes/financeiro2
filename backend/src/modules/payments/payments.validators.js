const { z } = require('zod');

// Aceita id como número ou string numérica (BigInt vem como string no JSON).
const idSchema = z.union([z.string().regex(/^\d+$/), z.number().int().positive()]);

const payBatchSchema = z.object({
  expenseIds: z.array(idSchema).default([]),
  invoiceIds: z.array(idSchema).default([]),
  // Só saldo da conta ou dinheiro físico. Crédito é recusado no serviço.
  paymentMethod: z.enum(['debit', 'cash']).default('debit'),
}).refine(
  (data) => (data.expenseIds.length + data.invoiceIds.length) > 0,
  { message: 'Selecione ao menos uma conta ou fatura para pagar.', path: ['expenseIds'] }
).refine(
  (data) => (data.expenseIds.length + data.invoiceIds.length) <= 100,
  { message: 'Máximo de 100 itens por pagamento em lote.', path: ['expenseIds'] }
);

module.exports = { payBatchSchema };
