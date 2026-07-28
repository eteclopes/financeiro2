jest.mock('../../src/config/prisma', () => require('../helpers/prismaMock').createPrismaMock());

const prismaMock = require('../../src/config/prisma');
const { installDefaults } = require('../helpers/prismaMock');

beforeEach(() => installDefaults(prismaMock));

/**
 * Parcela de cartão NÃO é pendência do mês: ela pertence à fatura e só vira
 * saída de dinheiro quando a fatura é paga. Enquanto entrava nas pendências,
 * inflava o total (parecia que a compra já tinha comido o saldo), aparecia na
 * lista do "Pagar conta" e o pagamento era recusado com 409 PAY_VIA_INVOICE.
 */
describe('Cartão fora das pendências do mês', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (rel) => fs.readFileSync(path.join(__dirname, '../../src', rel), 'utf8');

  // Conta quantas consultas de "pendência" existem sem o recorte de tipo.
  function pendingQueriesWithoutCardFilter(source) {
    return source
      .split('prisma.expense.')
      .slice(1)
      .filter((chunk) => {
        const head = chunk.slice(0, 400);
        return /status:\s*\{\s*in:\s*\['pending'/.test(head)
          && !/type:\s*\{\s*not:\s*'card'\s*\}/.test(head);
      });
  }

  test('dashboard: nenhuma consulta de pendência inclui parcela de cartão', () => {
    const source = read('modules/dashboard/dashboard.service.js');
    // Existem 3 consultas de pendência: soma, lista e contagem.
    const total = (source.match(/status:\s*\{\s*in:\s*\['pending'/g) || []).length;
    expect(total).toBeGreaterThanOrEqual(3);
    expect(pendingQueriesWithoutCardFilter(source)).toEqual([]);
  });

  test('prévia de fechamento também não conta cartão como pendência', () => {
    const source = read('modules/closing/closing.service.js');
    // getClosingPreview tem 2 consultas de pendência (contagem e soma).
    const preview = source.slice(source.indexOf('async function getClosingPreview'));
    expect(pendingQueriesWithoutCardFilter(preview.slice(0, 1500))).toEqual([]);
  });

  test('a lista do pagamento em lote continua sem parcelas de cartão avulsas', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../src/modules/payments/payments.service.js'), 'utf8'
    );
    // Contas: só variável e fixa. Cartão se paga pela fatura.
    expect(src).toContain("type: { in: ['variable', 'fixed'] }");
    expect(src).toContain('PAY_VIA_INVOICE');
  });
});
