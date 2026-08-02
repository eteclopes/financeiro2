const { Router } = require('express');
const authenticate = require('../../middlewares/authenticate');
const validate = require('../../middlewares/validate');
const asyncHandler = require('../../utils/asyncHandler');
const AppError = require('../../utils/AppError');
const service = require('./workspaces.service');
const { workspaceId, createWorkspaceSchema, renameWorkspaceSchema } = require('./workspaces.validators');

const router = Router();
router.use(authenticate);

function parseWorkspaceId(value) {
  const result = workspaceId.safeParse(value);
  if (!result.success) throw new AppError('Identificador inválido.', 422, 'VALIDATION_ERROR');
  return BigInt(result.data);
}

router.get('/', asyncHandler(async (req, res) => {
  res.json(await service.listWorkspaces(req.ownerUserId || req.userId));
}));

router.post('/', validate(createWorkspaceSchema), asyncHandler(async (req, res) => {
  const workspace = await service.createWorkspace(req.ownerUserId || req.userId, req.body);
  res.status(201).json({ workspace });
}));

router.patch('/:id', validate(renameWorkspaceSchema), asyncHandler(async (req, res) => {
  const workspace = await service.renameWorkspace(
    req.ownerUserId || req.userId,
    parseWorkspaceId(req.params.id),
    req.body.name
  );
  res.json({ workspace });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await service.deleteWorkspace(req.ownerUserId || req.userId, parseWorkspaceId(req.params.id));
  res.status(204).send();
}));

module.exports = router;
