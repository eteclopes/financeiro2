const { Router } = require('express');
const asyncHandler = require('../../utils/asyncHandler');
const authenticate = require('../../middlewares/authenticate');
const validate = require('../../middlewares/validate');
const { parseMonthId } = require('../../utils/parseParams');
const service = require('./payments.service');
const { payBatchSchema } = require('./payments.validators');

const router = Router();
router.use(authenticate);

// Lista o que pode ser pago em lote no mês: contas pendentes + faturas abertas.
router.get('/payable', asyncHandler(async (req, res) => {
  const monthId = parseMonthId(req.query);
  const items = await service.getPayableItems(req.userId, monthId);
  res.json(items);
}));

// Paga várias contas e/ou faturas de uma vez.
router.post('/batch', validate(payBatchSchema), asyncHandler(async (req, res) => {
  const result = await service.payBillsBatch(req.userId, req.body);
  res.json(result);
}));

module.exports = router;
