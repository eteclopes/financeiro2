const { Router } = require('express');
const asyncHandler = require('../../utils/asyncHandler');
const authenticate = require('../../middlewares/authenticate');
const validate = require('../../middlewares/validate');
const service = require('./subscriptions.service');
const { createSubscriptionSchema, updateSubscriptionSchema } = require('./subscriptions.validators');

const router = Router();
router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const subscriptions = await service.listSubscriptions(req.userId);
    res.json({ subscriptions });
  })
);

router.post(
  '/',
  validate(createSubscriptionSchema),
  asyncHandler(async (req, res) => {
    const subscription = await service.createSubscription(req.userId, req.body);
    res.status(201).json({ subscription });
  })
);

router.patch(
  '/:id',
  validate(updateSubscriptionSchema),
  asyncHandler(async (req, res) => {
    const subscription = await service.updateSubscription(req.userId, BigInt(req.params.id), req.body);
    res.json({ subscription });
  })
);

router.post(
  '/:id/pause',
  asyncHandler(async (req, res) => {
    const subscription = await service.pauseSubscription(req.userId, BigInt(req.params.id));
    res.json({ subscription });
  })
);

router.post(
  '/:id/resume',
  asyncHandler(async (req, res) => {
    const subscription = await service.resumeSubscription(req.userId, BigInt(req.params.id));
    res.json({ subscription });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await service.cancelSubscription(req.userId, BigInt(req.params.id));
    res.status(204).send();
  })
);

module.exports = router;
