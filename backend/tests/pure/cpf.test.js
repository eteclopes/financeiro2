const { isValidCPF, formatCPF } = require('../../src/utils/cpf');

describe('isValidCPF', () => {
  test('CPF válido (com pontuação) é aceito', () => {
    expect(isValidCPF('529.982.247-25')).toBe(true);
  });

  test('CPF válido (só dígitos) é aceito', () => {
    expect(isValidCPF('52998224725')).toBe(true);
  });

  test('dígito verificador errado é rejeitado', () => {
    expect(isValidCPF('529.982.247-26')).toBe(false);
  });

  test('sequência de dígitos repetidos (ex.: 111.111.111-11) é rejeitada mesmo passando no cálculo', () => {
    expect(isValidCPF('111.111.111-11')).toBe(false);
    expect(isValidCPF('000.000.000-00')).toBe(false);
  });

  test('tamanho errado é rejeitado', () => {
    expect(isValidCPF('123456789')).toBe(false);
    expect(isValidCPF('123456789012')).toBe(false);
  });

  test('valores não-string ou vazios são rejeitados sem lançar erro', () => {
    expect(isValidCPF(null)).toBe(false);
    expect(isValidCPF(undefined)).toBe(false);
    expect(isValidCPF('')).toBe(false);
    expect(isValidCPF(12345678900)).toBe(false); // número, não string
  });
});

describe('formatCPF', () => {
  test('formata dígitos puros com pontuação padrão', () => {
    expect(formatCPF('52998224725')).toBe('529.982.247-25');
  });
});
