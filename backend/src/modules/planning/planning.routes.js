const { Router } = require('express');
const authenticate = require('../../middlewares/authenticate');
const requirePro = require('../../middlewares/requirePro');
const asyncHandler = require('../../utils/asyncHandler');
const { parseMonthId } = require('../../utils/parseParams');
const service = require('./planning.service');

const router = Router();
router.use(authenticate, requirePro);
router.get('/', asyncHandler(async (req, res) => {
  const monthId = parseMonthId(req.query);
  res.json(await service.getPlanningOverview(req.userId, monthId));
}));

module.exports = router;
