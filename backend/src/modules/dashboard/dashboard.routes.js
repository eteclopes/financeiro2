const { Router } = require('express');
const asyncHandler = require('../../utils/asyncHandler');
const authenticate = require('../../middlewares/authenticate');
const { parseMonthId } = require('../../utils/parseParams');
const service = require('./dashboard.service');

const router = Router();
router.use(authenticate);

router.get('/', asyncHandler(async (req, res) => {
  const monthId = parseMonthId(req.query);
  const dashboard = await service.getDashboard(req.userId, monthId);
  res.json(dashboard);
}));

module.exports = router;
