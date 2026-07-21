const { classifyCommitment } = require('../../src/modules/_shared/commitment');

describe('classifyCommitment', () => {
  test('até 40% é saudável', () => {
    expect(classifyCommitment(0)).toBe('saudavel');
    expect(classifyCommitment(0.4)).toBe('saudavel');
  });

  test('40%-60% é atenção', () => {
    expect(classifyCommitment(0.41)).toBe('atencao');
    expect(classifyCommitment(0.6)).toBe('atencao');
  });

  test('60%-80% é risco', () => {
    expect(classifyCommitment(0.61)).toBe('risco');
    expect(classifyCommitment(0.8)).toBe('risco');
  });

  test('acima de 80% é crítico', () => {
    expect(classifyCommitment(0.81)).toBe('critico');
    expect(classifyCommitment(1.5)).toBe('critico');
  });
});
