const { parseMonthId } = require('../../utils/parseParams');
const { Router } = require('express');
const asyncHandler = require('../../utils/asyncHandler');
const authenticate = require('../../middlewares/authenticate');
const service = require('./financialHealth.service');

const router = Router();
router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const monthId = parseMonthId(req.query);
    const result = await service.getOrComputeHealthScore(req.userId, monthId);
    res.json(result);
  })
);

module.exports = router;
