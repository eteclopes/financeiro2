const AppError = require('../utils/AppError');

/**
 * Toda rota que recebe body deve declarar um schema Zod e passar por aqui.
 * Isso garante que nenhum controller jamais lide com dado não validado —
 * a validação acontece na borda, antes de qualquer lógica de negócio.
 */
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const details = result.error.flatten().fieldErrors;
      throw new AppError('Dados inválidos.', 422, 'VALIDATION_ERROR', details);
    }

    req.body = result.data;
    next();
  };
}

module.exports = validate;
