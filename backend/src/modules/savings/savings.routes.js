const { Router } = require('express');
const asyncHandler = require('../../utils/asyncHandler');
const authenticate = require('../../middlewares/authenticate');
const validate = require('../../middlewares/validate');
const service = require('./savings.service');
const {
  savingsMovementSchema,
  savingsBucketSchema,
  savingsBucketUpdateSchema,
  savingsTransferSchema,
} = require('./savings.validators');
const { parseBigIntParam } = require('../../utils/parseParams');

const router = Router();
router.use(authenticate);

router.get('/', asyncHandler(async (req, res) => {
  const [balance, buckets, archivedBuckets, transactions, breakdown] = await Promise.all([
    service.getCurrentBalance(req.userId),
    service.listBuckets(req.userId),
    service.listArchivedBuckets(req.userId),
    service.listTransactions(req.userId),
    service.getBalanceBreakdown(req.userId),
  ]);
  res.json({ balance, buckets, archivedBuckets, transactions, breakdown });
}));

router.post('/buckets', validate(savingsBucketSchema), asyncHandler(async (req, res) => {
  const bucket = await service.createBucket(req.userId, req.body);
  res.status(201).json({ bucket });
}));

router.patch('/buckets/:id', validate(savingsBucketUpdateSchema), asyncHandler(async (req, res) => {
  const bucket = await service.updateBucket(req.userId, parseBigIntParam(req.params.id, 'id'), req.body);
  res.json({ bucket });
}));

router.delete('/buckets/:id', asyncHandler(async (req, res) => {
  const bucket = await service.archiveBucket(req.userId, parseBigIntParam(req.params.id, 'id'));
  res.json({ bucket });
}));

router.post('/buckets/:id/restore', asyncHandler(async (req, res) => {
  const bucket = await service.restoreBucket(req.userId, parseBigIntParam(req.params.id, 'id'));
  res.json({ bucket });
}));

router.post('/transfer', validate(savingsTransferSchema), asyncHandler(async (req, res) => {
  const transfer = await service.transfer(req.userId, req.body);
  res.status(201).json({ transfer });
}));

router.post('/deposit', validate(savingsMovementSchema), asyncHandler(async (req, res) => {
  const transaction = await service.deposit(req.userId, req.body);
  res.status(201).json({ transaction });
}));

router.post('/withdraw', validate(savingsMovementSchema), asyncHandler(async (req, res) => {
  const transaction = await service.withdraw(req.userId, req.body);
  res.status(201).json({ transaction });
}));

router.patch('/:id', validate(savingsMovementSchema), asyncHandler(async (req, res) => {
  const transaction = await service.updateLastTransaction(req.userId, parseBigIntParam(req.params.id, 'id'), req.body);
  res.json({ transaction });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const transaction = await service.deleteLastTransaction(req.userId, parseBigIntParam(req.params.id, 'id'));
  res.json({ transaction });
}));

module.exports = router;
