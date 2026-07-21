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
  const income = await service.updateIncome(req.userId, parseBigIntParam(req.params.id, 'id'), req.body);
  res.json({ income });
});

const remove = asyncHandler(async (req, res) => {
  await service.deleteIncome(req.userId, parseBigIntParam(req.params.id, 'id'));
  res.status(204).send();
});

const deactivateTemplate = asyncHandler(async (req, res) => {
  const template = await service.deactivateRecurringTemplate(req.userId, parseBigIntParam(req.params.id, 'id'));
  res.json({ template });
});

module.exports = { list, create, update, remove, deactivateTemplate };
