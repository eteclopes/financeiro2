const { parseMonthId } = require('../../utils/parseParams');
const { Router } = require('express');
const asyncHandler = require('../../utils/asyncHandler');
const authenticate = require('../../middlewares/authenticate');
const service = require('./alerts.service');

const router = Router();
router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const monthId = parseMonthId(req.query);
    // Polling da Topbar cai aqui a cada 60s por aba: leitura pura, com
    // recomputação no máximo a cada 5 minutos por usuário/mês.
    const alerts = await service.getAlerts(req.userId, monthId, { windowMs: 5 * 60_000 });
    res.json({ alerts });
  })
);

module.exports = router;
