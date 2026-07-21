const { Router } = require('express');
const authenticate = require('../../middlewares/authenticate');
const validate = require('../../middlewares/validate');
const { z } = require('zod');
const controller = require('./expenses.controller');
const {
  createVariableExpenseSchema,
  createFixedExpenseSchema,
  updateExpenseSchema,
  payExpenseSchema,
  PAYMENT_METHODS,
} = require('./expenses.validators');

const updateFixedTemplateSchema = z.object({
  description: z.string().trim().min(1).max(160).optional(),
  value: z.coerce.number().positive().optional(),
  categoryId: z.coerce.bigint().optional(),
  dueDay: z.coerce.number().int().min(1).max(31).optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  cardId: z.preprocess(
    (value) => value === '' || value === null ? null : value,
    z.coerce.bigint().nullable()
  ).optional(),
}).refine((data) => data.paymentMethod !== 'credit' || (data.cardId !== undefined && data.cardId !== null), {
  message: 'Selecione o cartão quando a forma de pagamento for Cartão de Crédito.',
  path: ['cardId'],
});

const router = Router();
router.use(authenticate);

// Listagem
router.get('/', controller.list);

// Criação
router.post('/variable', validate(createVariableExpenseSchema), controller.createVariable);
router.post('/fixed', validate(createFixedExpenseSchema), controller.createFixed);

// Rotas específicas de templates (ANTES de /:id para não conflitar)
router.patch('/fixed/templates/:id/deactivate', controller.deactivateFixedTemplate);
router.patch('/fixed/templates/:id', validate(updateFixedTemplateSchema), controller.updateFixedTemplate);
router.delete('/fixed/templates/:id', controller.deleteFixedTemplate);

// Rotas genéricas por ID de instância
router.patch('/:id', validate(updateExpenseSchema), controller.update);
router.delete('/:id', controller.remove);
router.post('/:id/pay', validate(payExpenseSchema), controller.pay);

module.exports = router;
