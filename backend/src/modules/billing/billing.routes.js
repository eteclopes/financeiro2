const { Router } = require('express');
const authenticate = require('../../middlewares/authenticate');
const controller = require('./billing.controller');
const { billingLimiter } = require('../../middlewares/rateLimiters');

const router = Router();
router.use(authenticate);
router.get('/status', controller.status);
router.post('/checkout', billingLimiter, controller.checkout);

module.exports = router;
