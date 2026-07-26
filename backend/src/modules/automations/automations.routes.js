const { Router } = require('express');
const asyncHandler = require('../../utils/asyncHandler');
const authenticate = require('../../middlewares/authenticate');
const validate = require('../../middlewares/validate');
const service = require('./automations.service');
const { updateSettingsSchema, runNowSchema } = require('./automations.validators');

const router = Router();
router.use(authenticate);

// Configuração atual das automações do usuário.
router.get('/', asyncHandler(async (req, res) => {
  res.json({ settings: await service.getSettings(req.userId) });
}));

// Salvar configuração (ligar/desligar interruptores, método, % da sobra...).
router.put('/', validate(updateSettingsSchema), asyncHandler(async (req, res) => {
  res.json({ settings: await service.updateSettings(req.userId, req.body) });
}));

// "Rodar agora": executa as automações LIGADAS no mês informado, sem fechar.
router.post('/run', validate(runNowSchema), asyncHandler(async (req, res) => {
  const result = await service.runNow(req.userId, req.body.monthId, { onlyEnabled: true });
  res.json({ result });
}));

module.exports = router;
