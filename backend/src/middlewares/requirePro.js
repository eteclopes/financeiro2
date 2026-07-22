const asyncHandler = require('../utils/asyncHandler');
const { assertPro } = require('../modules/plans/plans.service');

module.exports = asyncHandler(async (req, _res, next) => {
  await assertPro(req.userId);
  next();
});
