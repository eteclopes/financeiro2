const jwt = require('jsonwebtoken');
const env = require('../../src/config/env');
const { signAccessToken, verifyAccessToken } = require('../../src/utils/tokens');

describe('access token hardening', () => {
  test('token válido inclui tipo, emissor e audiência esperados', () => {
    const token = signAccessToken(42n);
    const payload = verifyAccessToken(token);
    expect(payload).toMatchObject({
      sub: '42',
      typ: 'access',
      iss: env.JWT_ISSUER,
      aud: env.JWT_AUDIENCE,
    });
  });

  test('rejeita token com audiência diferente', () => {
    const token = jwt.sign(
      { sub: '42', typ: 'access' },
      env.JWT_ACCESS_SECRET,
      { algorithm: 'HS256', issuer: env.JWT_ISSUER, audience: 'outro-cliente', expiresIn: '5m' },
    );
    expect(() => verifyAccessToken(token)).toThrow();
  });
});
