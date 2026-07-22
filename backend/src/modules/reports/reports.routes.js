const { Router } = require('express');
const asyncHandler = require('../../utils/asyncHandler');
const authenticate = require('../../middlewares/authenticate');
const requirePro = require('../../middlewares/requirePro');
const { parseMonthId } = require('../../utils/parseParams');
const dashboardService = require('../dashboard/dashboard.service');

const router = Router();
router.use(authenticate, requirePro);

// O relatório usa a mesma fonte consolidada do Dashboard para que totais,
// cartões, metas e score nunca divirjam entre telas. A diferença é que este
// endpoint é protegido pelo plano Pro e atende exportações/visões analíticas.
router.get('/', asyncHandler(async (req, res) => {
  const monthId = parseMonthId(req.query);
  res.json(await dashboardService.getDashboard(req.userId, monthId));
}));

module.exports = router;
