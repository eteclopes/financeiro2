const { Router } = require('express');
const asyncHandler = require('../../utils/asyncHandler');
const authenticate = require('../../middlewares/authenticate');
const monthsService = require('./months.service');
const closingService = require('../closing/closing.service');
const calendarClosingService = require('../closing/calendarClosing.service');
const automationsService = require('../automations/automations.service');
const AppError = require('../../utils/AppError');
const { parseBigIntParam } = require('../../utils/parseParams');

const router = Router();
router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const months = await monthsService.listMonths(req.userId, {
      includeFuture: req.workspace?.type === 'simulation',
    });
    res.json({ months, mode: req.workspace?.type || 'real' });
  })
);

router.get(
  '/current',
  asyncHandler(async (req, res) => {
    const month = await monthsService.findCurrentMonthOrThrow(req.userId);
    res.json({ month, mode: req.workspace?.type || 'real' });
  })
);


router.post(
  '/sync-calendar',
  asyncHandler(async (req, res) => {
    if (req.workspace?.type === 'simulation') {
      return res.json({ current: null, closed: [], mode: 'simulation' });
    }
    const result = await calendarClosingService.ensureCalendarMonthsClosed(req.userId);
    return res.json({ ...result, mode: 'real' });
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
    const monthId = parseBigIntParam(req.params.id, 'id');
    if (req.workspace?.type !== 'simulation') {
      const month = await monthsService.getMonthOrThrow(req.userId, monthId);
      if (month.status !== 'closed') {
        throw new AppError(
          'No financeiro real, o mês é encerrado automaticamente na virada do calendário.',
          409,
          'REAL_MONTH_AUTO_CLOSE'
        );
      }
    }
    const preview = await closingService.getClosingPreview(req.userId, monthId);
    res.json(preview);
  })
);

router.post(
  '/:id/close',
  asyncHandler(async (req, res) => {
    const monthId = parseBigIntParam(req.params.id, 'id');
    if (req.workspace?.type !== 'simulation') {
      const month = await monthsService.getMonthOrThrow(req.userId, monthId);
      if (month.status !== 'closed') {
        throw new AppError(
          'No financeiro real, o mês é encerrado automaticamente na virada do calendário.',
          409,
          'REAL_MONTH_AUTO_CLOSE'
        );
      }
    }

    const result = await closingService.closeMonth(req.userId, monthId);
    if (!result.repaired && result.nextMonth?.id) {
      result.automations = await automationsService.runOnClose(req.userId, result.nextMonth.id);
    }
    res.json(result);
  })
);

router.post(
  '/:id/reopen',
  asyncHandler(async (req, res) => {
    if (req.workspace?.type !== 'simulation') {
      throw new AppError('Somente meses simulados podem ser reabertos.', 409, 'REAL_MONTH_REOPEN_BLOCKED');
    }
    const result = await closingService.reopenSimulationMonth(
      req.userId,
      parseBigIntParam(req.params.id, 'id')
    );
    res.json(result);
  })
);

module.exports = router;
