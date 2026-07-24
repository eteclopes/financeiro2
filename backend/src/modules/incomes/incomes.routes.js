const { Router } = require('express');
const authenticate = require('../../middlewares/authenticate');
const validate = require('../../middlewares/validate');
const controller = require('./incomes.controller');
const { createIncomeSchema, updateIncomeSchema } = require('./incomes.validators');

const router = Router();
router.use(authenticate);

router.get('/', controller.list);
router.post('/', validate(createIncomeSchema), controller.create);

// CORREÇÃO BUG 2: Rota específica /templates/:id ANTES da rota genérica /:id
// O Express resolve rotas na ordem em que foram registradas — se /:id vier
// antes, "templates" é capturado como :id e a rota específica nunca é atingida.
router.patch('/templates/:id/deactivate', controller.deactivateTemplate);
// Encerrar a recorrência a partir de um lançamento (não apaga histórico).
router.post('/:id/end-recurrence', controller.endRecurrence);

router.patch('/:id', validate(updateIncomeSchema), controller.update);
router.delete('/:id', controller.remove);

module.exports = router;
