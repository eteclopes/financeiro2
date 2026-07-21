const { addMonths } = require('../../src/utils/monthMath');

describe('addMonths', () => {
  test('soma dentro do mesmo ano', () => {
    expect(addMonths(3, 2026, 2)).toEqual({ month: 5, year: 2026 });
  });

  test('rollover de dezembro para janeiro do ano seguinte', () => {
    expect(addMonths(11, 2026, 2)).toEqual({ month: 1, year: 2027 });
  });

  test('delta 0 retorna o mesmo mês/ano', () => {
    expect(addMonths(6, 2026, 0)).toEqual({ month: 6, year: 2026 });
  });

  test('rollover de múltiplos anos', () => {
    expect(addMonths(1, 2026, 24)).toEqual({ month: 1, year: 2028 });
  });

  test('dezembro + 1 vira janeiro do ano seguinte (caso de borda comum em faturas)', () => {
    expect(addMonths(12, 2026, 1)).toEqual({ month: 1, year: 2027 });
  });
});
