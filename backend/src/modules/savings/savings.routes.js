const { Router } = require('express');
const asyncHandler = require('../../utils/asyncHandler');
const authenticate = require('../../middlewares/authenticate');
const validate = require('../../middlewares/validate');
const service = require('./savings.service');
const { savingsMovementSchema } = require('./savings.validators');

const router = Router();
router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const [balance, transactions, breakdown] = await Promise.all([
      service.getCurrentBalance(req.userId),
      service.listTransactions(req.userId),
      service.getBalanceBreakdown(req.userId),
    ]);
    res.json({ balance, transactions, breakdown });
  })
);

router.post(
  '/deposit',
  validate(savingsMovementSchema),
  asyncHandler(async (req, res) => {
    const transaction = await service.deposit(req.userId, req.body);
    res.status(201).json({ transaction });
  })
);

router.post(
  '/withdraw',
  validate(savingsMovementSchema),
  asyncHandler(async (req, res) => {
    const transaction = await service.withdraw(req.userId, req.body);
    res.status(201).json({ transaction });
  })
);

// Só aceitam o ID do lançamento mais recente — ver comentário em
// savings.service.updateLastTransaction sobre por que isso é uma cadeia
// sequencial e não dá pra editar/excluir lançamentos arbitrários do meio.
router.patch(
  '/:id',
  validate(savingsMovementSchema),
  asyncHandler(async (req, res) => {
    const transaction = await service.updateLastTransaction(req.userId, BigInt(req.params.id), req.body);
    res.json({ transaction });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const transaction = await service.deleteLastTransaction(req.userId, BigInt(req.params.id));
    res.json({ transaction });
  })
);

module.exports = router;
