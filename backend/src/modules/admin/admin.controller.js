const asyncHandler = require('../../utils/asyncHandler');
const service = require('./admin.service');

const overview = asyncHandler(async (req, res) => {
  res.json(await service.overview());
});

const listUsers = asyncHandler(async (req, res) => {
  res.json(await service.listUsers(req.query));
});

const getUser = asyncHandler(async (req, res) => {
  res.json({ user: await service.getUser(req.params.id) });
});

const updateUserPlan = asyncHandler(async (req, res) => {
  const { plan } = req.body;
  const user = await service.updateUserPlan(req.userId, req.params.id, plan);
  res.json({ user });
});

const updateUserRole = asyncHandler(async (req, res) => {
  const user = await service.updateUserRole(req.userId, req.params.id, req.body.role);
  res.json({ user });
});

const revokeUserSessions = asyncHandler(async (req, res) => {
  res.json(await service.revokeUserSessions(req.userId, req.params.id));
});

const deleteUser = asyncHandler(async (req, res) => {
  await service.deleteUser(req.userId, req.params.id);
  res.status(204).send();
});

const listBilling = asyncHandler(async (req, res) => {
  res.json(await service.listBilling(req.query));
});

const listAudit = asyncHandler(async (req, res) => {
  res.json(await service.listAudit(req.query));
});

const systemStatus = asyncHandler(async (req, res) => {
  res.json(await service.systemStatus());
});

module.exports = {
  overview,
  listUsers,
  getUser,
  updateUserPlan,
  updateUserRole,
  revokeUserSessions,
  deleteUser,
  listBilling,
  listAudit,
  systemStatus,
};
