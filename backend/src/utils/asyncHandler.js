/**
 * Envolve um controller async para encaminhar qualquer rejeição de Promise
 * ao middleware de erro central, em vez de exigir try/catch em cada rota.
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
