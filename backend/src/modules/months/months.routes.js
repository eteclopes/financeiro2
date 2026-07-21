const { Router } = require('express');
const asyncHandler = require('../../utils/asyncHandler');
const authenticate = require('../../middlewares/authenticate');
const monthsService = require('./months.service');
const closingService = require('../closing/closing.service');
const { parseBigIntParam } = require('../../utils/parseParams');

const router = Router();
router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const months = await monthsService.listMonths(req.userId);
    res.json({ months });
  })
);

router.get(
  '/current',
  asyncHandler(async (req, res) => {
    const month = await monthsService.getCurrentMonth(req.userId);
    res.json({ month });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const month = await monthsService.getMonthOrThrow(req.userId, parseBigIntParam(req.params.id, 'id'));
    res.json({ month });
  })
);

router.get(
  '/:id/closing-preview',
  asyncHandler(async (req, res) => {
    const preview = await closingService.getClosingPreview(req.userId, parseBigIntParam(req.params.id, 'id'));
    res.json(preview);
  })
);

router.post(
  '/:id/close',
  asyncHandler(async (req, res) => {
    const result = await closingService.closeMonth(req.userId, parseBigIntParam(req.params.id, 'id'));
    res.json(result);
  })
);

module.exports = router;
