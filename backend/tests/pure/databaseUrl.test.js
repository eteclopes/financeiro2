const { normalizePrismaRuntimeUrl, getDatabaseTransportIssue } = require('../../src/config/databaseUrl');

describe('normalizePrismaRuntimeUrl', () => {
  test('adiciona pgbouncer=true ao transaction pooler do Supabase', () => {
    const input = 'postgresql://postgres.ref:senha@aws-0-us-east-1.pooler.supabase.com:6543/postgres';
    const output = normalizePrismaRuntimeUrl(input);

    expect(output).toContain('pgbouncer=true');
    expect(output).toContain(':6543/postgres');
  });

  test('também protege o session pooler do Supabase', () => {
    const input = 'postgresql://postgres.ref:senha@aws-0-us-east-1.pooler.supabase.com:5432/postgres';
    const output = normalizePrismaRuntimeUrl(input);

    expect(output).toContain('pgbouncer=true');
  });

  test('preserva outros parâmetros existentes', () => {
    const input = 'postgresql://postgres.ref:senha@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require';
    const output = normalizePrismaRuntimeUrl(input);

    expect(output).toContain('sslmode=require');
    expect(output).toContain('pgbouncer=true');
  });

  test('não altera conexão direta', () => {
    const input = 'postgresql://postgres:senha@db.abcdefghijkl.supabase.co:5432/postgres';
    expect(normalizePrismaRuntimeUrl(input)).toBe(input);
  });

  test('não quebra valor inválido', () => {
    expect(normalizePrismaRuntimeUrl('nao-e-url')).toBe('nao-e-url');
  });
});


describe('database transport security', () => {
  test('bloqueia sslmode=disable em produção', () => {
    expect(getDatabaseTransportIssue(
      'postgresql://user:pass@db.example.com:5432/app?sslmode=disable',
      'production',
    )).toContain('não é permitido');
  });

  test('não exige parâmetro explícito em provedor gerenciado', () => {
    expect(getDatabaseTransportIssue(
      'postgresql://user:pass@db.example.com:5432/app',
      'production',
    )).toBeNull();
  });
});
