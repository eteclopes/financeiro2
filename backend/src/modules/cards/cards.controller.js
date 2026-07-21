const asyncHandler = require('../../utils/asyncHandler');
const cardsService = require('./cards.service');
const purchasesService = require('./cardPurchases.service');
const invoicesService = require('./cardInvoices.service');

const listCards = asyncHandler(async (req, res) => {
  const cards = await cardsService.listCards(req.userId);
  res.json({ cards });
});

const createCard = asyncHandler(async (req, res) => {
  const card = await cardsService.createCard(req.userId, req.body);
  res.status(201).json({ card });
});

const updateCard = asyncHandler(async (req, res) => {
  const card = await cardsService.updateCard(req.userId, BigInt(req.params.id), req.body);
  res.json({ card });
});

const deactivateCard = asyncHandler(async (req, res) => {
  const card = await cardsService.deactivateCard(req.userId, BigInt(req.params.id));
  res.json({ card });
});

const deleteCard = asyncHandler(async (req, res) => {
  const result = await cardsService.deleteCard(req.userId, BigInt(req.params.id));
  res.json(result);
});

const createPurchase = asyncHandler(async (req, res) => {
  const result = await purchasesService.createCardPurchase(req.userId, {
    ...req.body,
    cardId: BigInt(req.params.id),
  });
  res.status(201).json(result);
});

const listInvoices = asyncHandler(async (req, res) => {
  const invoices = await invoicesService.listInvoices(req.userId, BigInt(req.params.id));
  res.json({ invoices });
});

const payInvoice = asyncHandler(async (req, res) => {
  const invoice = await invoicesService.payInvoice(
    req.userId,
    BigInt(req.params.invoiceId),
    req.body.paymentMethod
  );
  res.json({ invoice });
});

module.exports = {
  listCards,
  createCard,
  updateCard,
  deactivateCard,
  deleteCard,
  createPurchase,
  listInvoices,
  payInvoice,
};
