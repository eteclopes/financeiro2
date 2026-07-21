const { Router } = require('express');
const authenticate = require('../../middlewares/authenticate');
const validate = require('../../middlewares/validate');
const controller = require('./cards.controller');
const {
  createCardSchema,
  updateCardSchema,
  createCardPurchaseSchema,
  payInvoiceSchema,
} = require('./cards.validators');

const router = Router();
router.use(authenticate);

router.get('/', controller.listCards);
router.post('/', validate(createCardSchema), controller.createCard);
router.patch('/:id', validate(updateCardSchema), controller.updateCard);
router.patch('/:id/deactivate', controller.deactivateCard);
router.delete('/:id', controller.deleteCard);

router.post('/:id/purchases', validate(createCardPurchaseSchema), controller.createPurchase);

router.get('/:id/invoices', controller.listInvoices);
router.post('/invoices/:invoiceId/pay', validate(payInvoiceSchema), controller.payInvoice);

module.exports = router;
