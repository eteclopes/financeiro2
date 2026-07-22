const { Router } = require('express');
const { z } = require('zod');
const asyncHandler = require('../../utils/asyncHandler');
const authenticate = require('../../middlewares/authenticate');
const requirePro = require('../../middlewares/requirePro');
const AppError = require('../../utils/AppError');
const service = require('./projections.service');

const router = Router();
router.use(authenticate, requirePro);

const querySchema = z.object({
  monthId: z.coerce.bigint(),
  monthsAhead: z.coerce.number().int().min(1).max(24).default(12),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError('Parâmetros inválidos.', 422, 'VALIDATION_ERROR', parsed.error.flatten().fieldErrors);
    }
    const projection = await service.projectMonths(req.userId, parsed.data.monthId, parsed.data.monthsAhead);
    res.json({ projection });
  })
);

module.exports = router;
