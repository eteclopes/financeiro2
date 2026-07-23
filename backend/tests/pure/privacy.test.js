const {
  summarizeAuditValue,
  buildAuditSnapshot,
  maskEmail,
  sanitizeLogText,
} = require('../../src/utils/privacy');

describe('privacy helpers', () => {
  test('audit log não preserva valores, descrições, nomes, e-mails ou observações', () => {
    const source = {
      id: 9n,
      userId: 2n,
      description: 'Dívida pessoal sigilosa',
      totalValue: '8500.00',
      remainingBalance: '7200.00',
      observation: 'informação privada',
      email: 'felipe@example.com',
      name: 'Felipe',
      status: 'active',
      type: 'priority',
      updatedAt: new Date('2026-07-23T00:00:00Z'),
    };

    const summary = summarizeAuditValue(source);
    const serialized = JSON.stringify(summary);

    expect(serialized).not.toContain('8500');
    expect(serialized).not.toContain('7200');
    expect(serialized).not.toContain('Dívida pessoal');
    expect(serialized).not.toContain('informação privada');
    expect(serialized).not.toContain('felipe@example.com');
    expect(serialized).not.toContain('Felipe');
    expect(summary.state).toMatchObject({ status: 'active', type: 'priority' });
    expect(summary.fields).toEqual(expect.arrayContaining([
      'description', 'totalValue', 'remainingBalance', 'observation', 'email', 'name', 'status', 'type',
    ]));
  });

  test('registra apenas nomes dos campos alterados', () => {
    const { newSummary } = buildAuditSnapshot(
      { description: 'A', value: '10.00', status: 'pending' },
      { description: 'B', value: '12.00', status: 'paid' },
    );
    expect(newSummary.changedFields).toEqual(['description', 'status', 'value']);
    expect(JSON.stringify(newSummary)).not.toContain('12.00');
    expect(JSON.stringify(newSummary)).not.toContain('B');
  });

  test('mascara e-mail em logs', () => {
    expect(maskEmail('felipe@example.com')).toMatch(/^f\*+@example\.com$/);
  });

  test('remove quebras de linha e segredos comuns do texto de log', () => {
    const result = sanitizeLogText('erro\nBearer abc.def?token=segredo&x=1');
    expect(result).not.toContain('\n');
    expect(result).not.toContain('abc.def');
    expect(result).not.toContain('segredo');
  });
});
