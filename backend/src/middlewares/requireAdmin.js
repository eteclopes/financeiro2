const prisma = require('../config/prisma');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

/**
 * A autorização administrativa é consultada no banco em toda requisição.
 * O papel não fica confiado apenas ao JWT, portanto uma remoção de acesso
 * passa a valer imediatamente, mesmo para tokens emitidos anteriormente.
 */
module.exports = asyncHandler(async (req, res, next) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { id: true, role: true },
  });

  if (!user || user.role !== 'admin') {
    throw new AppError('Acesso restrito à administração.', 403, 'ADMIN_REQUIRED');
  }

  req.admin = user;
  next();
});
