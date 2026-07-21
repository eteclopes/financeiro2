/** Config mínima — projeto CommonJS puro, sem necessidade de transform/babel. */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  setupFiles: ['<rootDir>/tests/setupEnv.js'],
  resetMocks: true,
  verbose: true,
};
