const AppError = require('../../src/utils/AppError');
const {
  requestId,
  privateApiHeaders,
  enforceTrustedOrigin,
} = require('../../src/middlewares/security');

describe('security middleware', () => {
  test('gera request id e devolve no cabeçalho', () => {
    const req = { get: jest.fn(() => undefined) };
    const headers = {};
    const res = { setHeader: (key, value) => { headers[key] = value; } };
    const next = jest.fn();
    requestId(req, res, next);
    expect(req.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(headers['X-Request-ID']).toBe(req.id);
    expect(next).toHaveBeenCalled();
  });

  test('API financeira é marcada como no-store', () => {
    const req = { path: '/api/dashboard' };
    const headers = {};
    const res = { setHeader: (key, value) => { headers[key] = value; } };
    const next = jest.fn();
    privateApiHeaders(req, res, next);
    expect(headers['Cache-Control']).toContain('no-store');
  });

  test('rejeita POST de origem não confiável', () => {
    const middleware = enforceTrustedOrigin({ isAllowed: () => false });
    const req = { method: 'POST', path: '/api/incomes', get: () => 'https://malicioso.example' };
    expect(() => middleware(req, {}, jest.fn())).toThrow(AppError);
  });

  test('permite chamada servidor-servidor sem Origin', () => {
    const middleware = enforceTrustedOrigin({ isAllowed: () => false });
    const next = jest.fn();
    const req = { method: 'POST', path: '/api/incomes', get: () => undefined };
    middleware(req, {}, next);
    expect(next).toHaveBeenCalled();
  });
});
