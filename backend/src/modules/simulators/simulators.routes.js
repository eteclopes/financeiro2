const { Router } = require('express');
const asyncHandler = require('../../utils/asyncHandler');
const authenticate = require('../../middlewares/authenticate');
const requirePro = require('../../middlewares/requirePro');
const validate = require('../../middlewares/validate');
const AppError = require('../../utils/AppError');
const purchaseService = require('./purchaseSimulator.service');
const whatIfService = require('./whatIfSimulator.service');
const { purchaseSimulationSchema } = require('./purchaseSimulator.validators');
const { previewSchema, saveSchema, scenarioInputMap } = require('./whatIfSimulator.validators');
const { parseBigIntParam } = require('../../utils/parseParams');

const router = Router();
router.use(authenticate, requirePro);

// ---- Simulador de Compras (Módulo 3) ----

router.post(
  '/purchase',
  validate(purchaseSimulationSchema),
  asyncHandler(async (req, res) => {
    const result = await purchaseService.simulatePurchase(req.userId, req.body);
    res.json(result);
  })
);

// ---- Simulador "E Se" (Módulo 4) ----

// Valida o sub-schema de input de acordo com o tipo de cenário informado,
// para não aceitar um pay_debt sem debtId, por exemplo.
function validateScenarioInput(payload) {
  const inputSchema = scenarioInputMap[payload.type];
  if (!inputSchema) throw new AppError('Tipo de cenário inválido.', 422, 'VALIDATION_ERROR');
  const result = inputSchema.safeParse(payload.input);
  if (!result.success) {
    throw new AppError('Input do cenário inválido.', 422, 'VALIDATION_ERROR', result.error.flatten().fieldErrors);
  }
  return result.data;
}

router.post(
  '/what-if/preview',
  validate(previewSchema),
  asyncHandler(async (req, res) => {
    const validInput = validateScenarioInput(req.body);
    const result = await whatIfService.runScenarioPreview(
      req.userId,
      req.body.monthId,
      req.body.type,
      validInput,
      req.body.monthsAhead
    );
    res.json(result);
  })
);

router.post(
  '/what-if/save',
  validate(saveSchema),
  asyncHandler(async (req, res) => {
    const validInput = validateScenarioInput(req.body);
    const result = await whatIfService.saveSimulation(req.userId, req.body.monthId, {
      type: req.body.type,
      name: req.body.name,
      input: validInput,
      monthsAhead: req.body.monthsAhead,
    });
    res.status(201).json(result);
  })
);

router.get(
  '/what-if',
  asyncHandler(async (req, res) => {
    const sims = await whatIfService.listSimulations(req.userId);
    res.json({ simulations: sims });
  })
);

router.delete(
  '/what-if/:id',
  asyncHandler(async (req, res) => {
    await whatIfService.deleteSimulation(req.userId, parseBigIntParam(req.params.id, 'id'));
    res.status(204).send();
  })
);

module.exports = router;
