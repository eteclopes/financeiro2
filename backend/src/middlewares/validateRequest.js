const AppError = require('../utils/AppError');

/** Valida body, query e params sem alterar o middleware legado de body. */
function validateRequest(schema) {
  return (req, res, next) => {
    const result = schema.safeParse({
      body: req.body,
      query: req.query,
      params: req.params,
    });

    if (!result.success) {
      const details = result.error.flatten().fieldErrors;
      throw new AppError('Dados inválidos.', 422, 'VALIDATION_ERROR', details);
    }

    if (result.data.body) req.body = result.data.body;
    if (result.data.query) req.query = result.data.query;
    if (result.data.params) req.params = result.data.params;
    next();
  };
}

module.exports = validateRequest;
