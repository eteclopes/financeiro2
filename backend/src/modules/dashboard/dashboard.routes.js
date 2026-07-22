const { Router } = require('express');
const { z } = require('zod');
const asyncHandler = require('../../utils/asyncHandler');
const authenticate = require('../../middlewares/authenticate');
const requirePro = require('../../middlewares/requirePro');
const AppError = require('../../utils/AppError');
const { parseMonthId } = require('../../utils/parseParams');
const service = require('./dashboard.service');
const preferencesService = require('./dashboardPreferences.service');

const router = Router();
router.use(authenticate);

const preferencesSchema = z.object({
  showSummaryChart: z.boolean().optional(),
  showAlerts: z.boolean().optional(),
  showRecommendations: z.boolean().optional(),
  showCards: z.boolean().optional(),
  showProjections: z.boolean().optional(),
  showCategoryChart: z.boolean().optional(),
  showGoals: z.boolean().optional(),
  summaryChart: z.enum(['bars', 'area']).optional(),
  projectionView: z.enum(['area', 'line']).optional(),
}).strict();

router.get('/preferences', requirePro, asyncHandler(async (req, res) => {
  const preferences = await preferencesService.getPreferences(req.userId);
  res.json({ preferences });
}));

router.patch('/preferences', requirePro, asyncHandler(async (req, res) => {
  const parsed = preferencesSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError('Preferências do dashboard inválidas.', 400, 'VALIDATION_ERROR', parsed.error.flatten());
  }
  if (Object.keys(parsed.data).length === 0) {
    throw new AppError('Envie ao menos uma preferência para atualizar.', 400, 'VALIDATION_ERROR');
  }
  const preferences = await preferencesService.updatePreferences(req.userId, parsed.data);
  res.json({ preferences });
}));

router.get('/', asyncHandler(async (req, res) => {
  const monthId = parseMonthId(req.query);
  const dashboard = await service.getDashboard(req.userId, monthId);
  res.json(dashboard);
}));

module.exports = router;
