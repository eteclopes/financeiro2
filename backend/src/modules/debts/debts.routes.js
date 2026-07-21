const { Router } = require('express');
const asyncHandler = require('../../utils/asyncHandler');
const authenticate = require('../../middlewares/authenticate');
const validate = require('../../middlewares/validate');
const service = require('./debts.service');
const { createDebtSchema, updateDebtSchema } = require('./debts.validators');

const router = Router();
router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const debts = await service.listDebts(req.userId);
    res.json({ debts });
  })
);

router.post(
  '/',
  validate(createDebtSchema),
  asyncHandler(async (req, res) => {
    const result = await service.createDebt(req.userId, req.body);
    res.status(201).json(result);
  })
);

router.patch(
  '/:id',
  validate(updateDebtSchema),
  asyncHandler(async (req, res) => {
    const debt = await service.updateDebt(req.userId, BigInt(req.params.id), req.body);
    res.json({ debt });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const debt = await service.deleteDebt(req.userId, BigInt(req.params.id));
    res.json({ debt });
  })
);

module.exports = router;