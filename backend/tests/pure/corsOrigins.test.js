const {
  normalizeOrigin,
  parseConfiguredOrigins,
  buildVercelPreviewRegex,
  createOriginPolicy,
} = require('../../src/utils/corsOrigins');

describe('corsOrigins', () => {
  test('normaliza domínio de produção sem protocolo para HTTPS', () => {
    expect(normalizeOrigin('financeiro2-six.vercel.app')).toBe(
      'https://financeiro2-six.vercel.app',
    );
  });

  test('mantém localhost em HTTP e remove barra final', () => {
    expect(normalizeOrigin('localhost:5173/')).toBe('http://localhost:5173');
    expect(normalizeOrigin('http://localhost:5173///')).toBe('http://localhost:5173');
  });

  test('aceita várias origens separadas por vírgula, ponto e vírgula ou linha', () => {
    expect(parseConfiguredOrigins(
      'financeiro2-six.vercel.app, https://app.exemplo.com/;\nhttp://localhost:5173',
    )).toEqual([
      'https://financeiro2-six.vercel.app',
      'https://app.exemplo.com',
      'http://localhost:5173',
    ]);
  });

  test('reconhece apenas previews do projeto e equipe configurados', () => {
    const regex = buildVercelPreviewRegex('financeiro2', 'eteclopes-projects');

    expect(regex.test('https://financeiro2-git-master-eteclopes-projects.vercel.app')).toBe(true);
    expect(regex.test('https://financeiro2-r08fpx7kg-eteclopes-projects.vercel.app')).toBe(true);
    expect(regex.test('https://outro-git-master-eteclopes-projects.vercel.app')).toBe(false);
    expect(regex.test('https://financeiro2-git-master-outra-equipe.vercel.app')).toBe(false);
  });

  test('autoriza domínio estável, previews confiáveis e chamadas sem Origin', () => {
    const policy = createOriginPolicy({
      configuredOrigins: ['financeiro2-six.vercel.app'],
      vercelProject: 'financeiro2',
      vercelTeam: 'eteclopes-projects',
    });

    expect(policy.isAllowed()).toBe(true);
    expect(policy.isAllowed('https://financeiro2-six.vercel.app')).toBe(true);
    expect(policy.isAllowed('https://financeiro2-git-master-eteclopes-projects.vercel.app')).toBe(true);
    expect(policy.isAllowed('https://site-malicioso.example')).toBe(false);
  });
});
