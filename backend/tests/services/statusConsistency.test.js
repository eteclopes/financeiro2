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

  test.each(arquivos)('%s trata flex_paid onde decide "já pago"', (rel) => {
    const source = read(rel);
    const linhas = source.split('\n');

    // Toda decisão de "isto já está pago?" precisa lidar com flex_paid — seja
    // incluindo-o na lista, seja tratando-o explicitamente por perto (o caso
    // do saldo residual, que é pagável e por isso NÃO pode entrar na lista).
    const naoTratadas = linhas
      .map((linha, i) => ({ linha, i }))
      .filter(({ linha }) => /\['paid',\s*'settled'\]/.test(linha) && !/flex_paid/.test(linha))
      .filter(({ i }) => {
        const vizinhanca = linhas.slice(Math.max(i - 4, 0), i + 4).join('\n');
        return !vizinhanca.includes('flex_paid');
      })
      .map(({ linha, i }) => `${rel}:${i + 1} → ${linha.trim()}`);

    expect(naoTratadas).toEqual([]);
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
