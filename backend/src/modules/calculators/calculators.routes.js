const { Router } = require('express');
const authenticate = require('../../middlewares/authenticate');
const requirePro = require('../../middlewares/requirePro');
const asyncHandler = require('../../utils/asyncHandler');
const AppError = require('../../utils/AppError');
const schemas = require('./calculators.validators');
const service = require('./calculators.service');

const handlers = {
  compound: service.calculateCompoundInterest,
  financing: service.calculateFinancing,
  'installment-cost': service.calculateInstallmentCost,
  'payoff-vs-invest': service.calculatePayoffVsInvest,
  'goal-plan': service.calculateGoalPlan,
};

const schemaByRoute = {
  compound: schemas.compound,
  financing: schemas.financing,
  'installment-cost': schemas.installmentCost,
  'payoff-vs-invest': schemas.payoffVsInvest,
  'goal-plan': schemas.goalPlan,
};

const router = Router();
router.use(authenticate, requirePro);
router.post('/:calculator', asyncHandler(async (req, res) => {
  const handler = handlers[req.params.calculator];
  const schema = schemaByRoute[req.params.calculator];
  if (!handler || !schema) throw new AppError('Calculadora não encontrada.', 404, 'CALCULATOR_NOT_FOUND');
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError('Dados inválidos.', 422, 'VALIDATION_ERROR', parsed.error.flatten().fieldErrors);
  }
  res.json({ result: handler(parsed.data) });
}));

module.exports = router;
