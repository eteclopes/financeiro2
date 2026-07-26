const asyncHandler = require('../../utils/asyncHandler');
const { parseMonthId, parseBigIntParam } = require('../../utils/parseParams');
const service = require('./expenses.service');

const list = asyncHandler(async (req, res) => {
  const monthId = parseMonthId(req.query);
  const { type } = req.query;
  const [expenses, overdueFromPrevious] = await Promise.all([
    service.listExpenses(req.userId, monthId, type),
    // Contas em aberto que ficaram para trás. Vão num campo separado para
    // não se misturarem aos totais do mês (a competência delas é outra).
    service.listOverdueFromPreviousMonths(req.userId, monthId),
  ]);
  res.json({ expenses, overdueFromPrevious });
});

const createVariable = asyncHandler(async (req, res) => {
  const expense = await service.createVariableExpense(req.userId, req.body);
  res.status(201).json({ expense });
});

const createFixed = asyncHandler(async (req, res) => {
  const expense = await service.createFixedExpense(req.userId, req.body);
  res.status(201).json({ expense });
});

const deactivateFixedTemplate = asyncHandler(async (req, res) => {
  const template = await service.deactivateFixedTemplate(req.userId, parseBigIntParam(req.params.id, 'id'));
  res.json({ template });
});

const updateFixedTemplate = asyncHandler(async (req, res) => {
  const template = await service.updateFixedTemplate(req.userId, parseBigIntParam(req.params.id, 'id'), req.body);
  res.json({ template });
});

const deleteFixedTemplate = asyncHandler(async (req, res) => {
  await service.deleteFixedTemplate(req.userId, parseBigIntParam(req.params.id, 'id'));
  res.status(204).send();
});

const update = asyncHandler(async (req, res) => {
  const expense = await service.updateExpense(req.userId, parseBigIntParam(req.params.id, 'id'), req.body);
  res.json({ expense });
});

const remove = asyncHandler(async (req, res) => {
  await service.deleteExpense(req.userId, parseBigIntParam(req.params.id, 'id'));
  res.status(204).send();
});

const pay = asyncHandler(async (req, res) => {
  const result = await service.payExpense(req.userId, parseBigIntParam(req.params.id, 'id'), req.body);
  res.json(result);
});

module.exports = { list, createVariable, createFixed, deactivateFixedTemplate, updateFixedTemplate, deleteFixedTemplate, update, remove, pay };
