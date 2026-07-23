const { Router } = require('express');
const validate = require('../../middlewares/validate');
const authenticate = require('../../middlewares/authenticate');
const { authLimiter, sessionLimiter } = require('../../middlewares/rateLimiters');
const controller = require('./auth.controller');
const {
  registerSchema,
  updateProfileSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} = require('./auth.validators');

const router = Router();

router.post('/register', authLimiter, validate(registerSchema), controller.register);
router.post('/login', authLimiter, validate(loginSchema), controller.login);
router.post('/refresh', sessionLimiter, controller.refresh);
router.post('/logout', sessionLimiter, controller.logout);
router.post('/forgot-password', authLimiter, validate(forgotPasswordSchema), controller.forgotPassword);
router.post('/reset-password', authLimiter, validate(resetPasswordSchema), controller.resetPassword);
router.get('/me', authenticate, controller.me);
router.patch('/me', authenticate, validate(updateProfileSchema), controller.updateProfile);

module.exports = router;
