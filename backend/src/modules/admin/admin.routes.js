const { Router } = require('express');
const authenticate = require('../../middlewares/authenticate');
const requireAdmin = require('../../middlewares/requireAdmin');
const validateRequest = require('../../middlewares/validateRequest');
const controller = require('./admin.controller');
const {
  listUsersSchema,
  userIdSchema,
  updatePlanSchema,
  updateRoleSchema,
  listBillingSchema,
  listAuditSchema,
} = require('./admin.validators');

const router = Router();

// Todas as rotas administrativas têm dupla proteção: sessão válida + papel
// consultado no banco. Nenhum dado administrativo é exposto antes disso.
router.use(authenticate, requireAdmin);

router.get('/overview', controller.overview);
router.get('/users', validateRequest(listUsersSchema), controller.listUsers);
router.get('/users/:id', validateRequest(userIdSchema), controller.getUser);
router.patch('/users/:id/plan', validateRequest(updatePlanSchema), controller.updateUserPlan);
router.patch('/users/:id/role', validateRequest(updateRoleSchema), controller.updateUserRole);
router.post('/users/:id/revoke-sessions', validateRequest(userIdSchema), controller.revokeUserSessions);
router.get('/billing', validateRequest(listBillingSchema), controller.listBilling);
router.get('/audit', validateRequest(listAuditSchema), controller.listAudit);
router.get('/system', controller.systemStatus);

module.exports = router;
