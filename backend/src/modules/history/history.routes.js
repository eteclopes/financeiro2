const { parseMonthId } = require('../../utils/parseParams');
const { Router } = require('express');
const asyncHandler = require('../../utils/asyncHandler');
const authenticate = require('../../middlewares/authenticate');
const service = require('./history.service');

const router = Router();
router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const monthId = parseMonthId(req.query);
    const periods = parseInt(req.query.periods ?? '6', 10);
    const result = await service.getFinancialHistory(req.userId, monthId, periods);
    res.json(result);
  })
);

// Extrato detalhado do mês: cada lançamento, o que foi pago e o que faltou.
router.get(
  '/statement',
  asyncHandler(async (req, res) => {
    const monthId = parseMonthId(req.query);
    res.json(await service.getMonthStatement(req.userId, monthId));
  })
);

module.exports = router;
