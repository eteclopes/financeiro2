/**
 * Erro de aplicação com status HTTP e código semântico.
 * Toda a camada de service deve lançar AppError (nunca Error genérico)
 * para que o errorHandler saiba diferenciar "erro esperado de negócio"
 * de "bug inesperado".
 */
class AppError extends Error {
  constructor(message, statusCode = 400, code = 'BAD_REQUEST', details = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;
