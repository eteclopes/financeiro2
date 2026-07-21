const { Router } = require('express');
const asyncHandler = require('../../utils/asyncHandler');
const authenticate = require('../../middlewares/authenticate');
const validate = require('../../middlewares/validate');
const AppError = require('../../utils/AppError');
const service = require('./categories.service');
const { createCategorySchema, updateCategorySchema, renameCategorySchema } = require('./categories.validators');
const { parseMonthId } = require('../../utils/parseParams');

const router = Router();
router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { type } = req.query;
    if (type !== 'income' && type !== 'expense') {
      throw new AppError('Parâmetro "type" deve ser "income" ou "expense".', 422, 'VALIDATION_ERROR');
    }
    const categories = await service.listCategories(req.userId, type);
    res.json({ categories });
  })
);

// Status de orçamento (limite x gasto) das categorias de despesa no mês.
router.get(
  '/budgets',
  asyncHandler(async (req, res) => {
    const monthId = parseMonthId(req.query);
    const budgets = await service.getBudgetStatus(req.userId, monthId);
    res.json({ budgets });
  })
);

router.post(
  '/',
  validate(createCategorySchema),
  asyncHandler(async (req, res) => {
    const category = await service.createCategory(req.userId, req.body);
    res.status(201).json({ category });
  })
);

router.patch(
  '/:id/limit',
  validate(updateCategorySchema),
  asyncHandler(async (req, res) => {
    const category = await service.updateCategoryLimit(req.userId, BigInt(req.params.id), req.body.monthlyLimit);
    res.json({ category });
  })
);

// Renomeia uma categoria própria do usuário (categorias padrão do sistema
// não podem ser renomeadas — ver comentário em categories.service.renameCategory).
router.patch(
  '/:id',
  validate(renameCategorySchema),
  asyncHandler(async (req, res) => {
    const category = await service.renameCategory(req.userId, BigInt(req.params.id), req.body.name);
    res.json({ category });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await service.deleteCategory(req.userId, BigInt(req.params.id));
    res.status(204).send();
  })
);

module.exports = router;
