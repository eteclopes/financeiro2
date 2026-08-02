const { Router } = require('express');
const validate = require('../../middlewares/validate');
const { authLimiter, sessionLimiter } = require('../../middlewares/rateLimiters');
const { authenticateAdmin } = require('../../middlewares/authenticate');
const requireAdmin = require('../../middlewares/requireAdmin');
const { loginSchema } = require('../auth/auth.validators');
const controller = require('./adminAuth.controller');

const router = Router();
router.post('/login', authLimiter, validate(loginSchema), controller.login);
router.post('/refresh', sessionLimiter, controller.refresh);
router.post('/logout', sessionLimiter, controller.logout);
router.get('/me', authenticateAdmin, requireAdmin, controller.me);
module.exports = router;
