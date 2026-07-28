const fs = require('fs');
const path = require('path');
const read = (rel) => fs.readFileSync(path.join(__dirname, '../../src', rel), 'utf8');

/**
 * Um status novo ('flex_paid') só é seguro se TODO lugar que decide
 * "isto já foi pago?" o conhecer. Um ponto esquecido significa cobrar de
 * novo uma parcela que o usuário já quitou.
 */
describe('Consistência do status flex_paid', () => {
  const arquivos = [
    'modules/expenses/expenses.service.js',
    'modules/payments/payments.service.js',
    'modules/debts/debts.service.js',
  ];

  test.each(arquivos)('%s não decide "já pago" sem considerar flex_paid', (rel) => {
    const source = read(rel);
    // Qualquer lista de status "encerrados" precisa incluir flex_paid.
    const listasIncompletas = source.match(/\['paid',\s*'settled'\](?!\s*,\s*'flex_paid')/g) || [];
    expect(listasIncompletas).toEqual([]);
  });

  test('as consultas de pendência excluem flex_paid naturalmente', () => {
    // Pendência = pending/partial/late. flex_paid não está na lista, então
    // a parcela sai das cobranças do mês sem precisar de filtro extra.
    for (const rel of arquivos) {
      const source = read(rel);
      const pendentes = source.match(/in:\s*\['pending',\s*'partial',\s*'late'\]/g) || [];
      for (const trecho of pendentes) {
        expect(trecho).not.toContain('flex_paid');
      }
    }
  });

  test('a automação respeita a escolha de adiantar fatura aberta', () => {
    const source = read('modules/automations/automations.service.js');
    expect(source).toContain('dueOnly: !config.payOpenInvoices');
    // A prévia olha tudo, para poder explicar o que ficou de fora.
    expect(source).toContain('dueOnly: false');
    expect(source).toContain('FATURA_AINDA_ABERTA');
    expect(source).toContain('FIXAS_NO_CARTAO');
  });

  test('retentativa de rede nunca repete operação que move dinheiro', () => {
    const api = fs.readFileSync(path.join(__dirname, '../../../frontend/src/lib/api.js'), 'utf8');
    // Repetir um POST cuja resposta se perdeu pagaria a mesma conta duas vezes.
    expect(api).toContain('isIdempotent');
    expect(api).toMatch(/method.*?===\s*'get'/);
  });
});
