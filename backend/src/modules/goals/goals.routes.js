const { Router } = require('express');
const asyncHandler = require('../../utils/asyncHandler');
const authenticate = require('../../middlewares/authenticate');
const validate = require('../../middlewares/validate');
const service = require('./goals.service');
const {
  createGoalSchema,
  updateGoalSchema,
  contributeSchema,
  cancelGoalSchema,
} = require('./goals.validators');

const router = Router();
router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const goals = await service.listGoals(req.userId);
    res.json({ goals });
  })
);

router.post(
  '/',
  validate(createGoalSchema),
  asyncHandler(async (req, res) => {
    const goal = await service.createGoal(req.userId, req.body);
    res.status(201).json({ goal });
  })
);

router.patch(
  '/:id',
  validate(updateGoalSchema),
  asyncHandler(async (req, res) => {
    const goal = await service.updateGoal(req.userId, BigInt(req.params.id), req.body);
    res.json({ goal });
  })
);

router.post(
  '/:id/contributions',
  validate(contributeSchema),
  asyncHandler(async (req, res) => {
    const contribution = await service.contribute(req.userId, BigInt(req.params.id), req.body);
    res.status(201).json({ contribution });
  })
);

router.post(
  '/:id/cancel',
  validate(cancelGoalSchema),
  asyncHandler(async (req, res) => {
    const result = await service.cancelGoal(req.userId, BigInt(req.params.id), req.body);
    res.json(result);
  })
);

module.exports = router;
