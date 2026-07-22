const { Router } = require('express');
const authenticate = require('../../middlewares/authenticate');
const controller = require('./billing.controller');

const router = Router();
router.use(authenticate);
router.get('/status', controller.status);
router.post('/checkout', controller.checkout);

module.exports = router;
