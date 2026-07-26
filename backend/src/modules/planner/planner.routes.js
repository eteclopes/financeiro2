const { Router } = require('express');
const asyncHandler = require('../../utils/asyncHandler');
const authenticate = require('../../middlewares/authenticate');
const { parseMonthId } = require('../../utils/parseParams');
const service = require('./planner.service');

const router = Router();
router.use(authenticate);

// Plano do mês: quanto guardar, quanto adiantar de dívida e quanto sobra
// livre — tudo em reais, calculado sobre o dinheiro real do mês.
router.get('/', asyncHandler(async (req, res) => {
  const monthId = parseMonthId(req.query);
  res.json({ plan: await service.getMonthlyPlan(req.userId, monthId) });
}));

module.exports = router;
