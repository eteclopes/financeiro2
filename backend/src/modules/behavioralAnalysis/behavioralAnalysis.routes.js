const { parseMonthId } = require('../../utils/parseParams');
const { Router } = require('express');
const asyncHandler = require('../../utils/asyncHandler');
const authenticate = require('../../middlewares/authenticate');
const service = require('./behavioralAnalysis.service');

const router = Router();
router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const monthId = parseMonthId(req.query);
    const periods = Math.min(parseInt(req.query.periods ?? '6', 10), 12);
    const result = await service.getBehavioralAnalysis(req.userId, monthId, periods);
    res.json(result);
  })
);

module.exports = router;
