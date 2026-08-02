const asyncHandler = require('../../utils/asyncHandler');
const { parseMonthId, parseBigIntParam } = require('../../utils/parseParams');
const service = require('./incomes.service');

const list = asyncHandler(async (req, res) => {
  const monthId = parseMonthId(req.query);
  const incomes = await service.listIncomes(req.userId, monthId);
  res.json({ incomes });
});

const create = asyncHandler(async (req, res) => {
  const income = await service.createIncome(req.userId, req.body);
  res.status(201).json({ income });
});

const update = asyncHandler(async (req, res) => {
  const { scope, ...payload } = req.body;
  const result = await service.updateIncome(
    req.userId,
    parseBigIntParam(req.params.id, 'id'),
    payload,
    { scope }
  );
  res.json(result);
});

const endRecurrence = asyncHandler(async (req, res) => {
  const result = await service.endRecurrence(req.userId, parseBigIntParam(req.params.id, 'id'));
  res.json(result);
});

const remove = asyncHandler(async (req, res) => {
  // Correção de erro de digitação pode exigir saldo negativo. O cliente
  // precisa confirmar explicitamente (?confirm=true) depois de ver o
  // impacto devolvido no erro 409.
  const allowNegativeBalance = req.query.confirm === 'true';
  const result = await service.deleteIncome(
    req.userId,
    parseBigIntParam(req.params.id, 'id'),
    { allowNegativeBalance }
  );
  res.json({
    deleted: result.action === 'deleted',
    reversed: result.action === 'reversed',
    action: result.action,
    resultingBalance: result.resultingBalance,
    wentNegative: result.wentNegative,
  });
});

const deactivateTemplate = asyncHandler(async (req, res) => {
  const template = await service.deactivateRecurringTemplate(req.userId, parseBigIntParam(req.params.id, 'id'));
  res.json({ template });
});

module.exports = { list, create, update, endRecurrence, remove, deactivateTemplate };
