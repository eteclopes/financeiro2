const fs = require('fs');
const path = require('path');
const read = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');

/**
 * FONTE ÚNICA DE VERDADE PARA "O QUE POSSO PAGAR".
 *
 * O modo individual lia a lista do dashboard e o modo em lote lia
 * `getPayableItems`. Duas respostas para a mesma pergunta, e elas divergiam:
 * a do dashboard só olha o mês selecionado, corta em 5 itens e não traz
 * faturas. Na prática, parcela atrasada de mês anterior e fatura só apareciam
 * no lote — exatamente o sintoma relatado.
 */
describe('Pagamento: uma fonte só para os dois modos', () => {
  const quick = read('../frontend/src/components/dashboard/QuickActions.jsx');

  test('o modo individual usa a lista unificada, não a do dashboard', () => {
    expect(quick).toContain('const payableAll = [');
    // A decisão de "não há nada a pagar" olha a lista unificada.
    expect(quick).toContain('(payableAll.length === 0)');
  });

  test('a lista unificada cobre contas, parcelas e faturas', () => {
    const bloco = quick.slice(quick.indexOf('const payableAll = ['), quick.indexOf('const batchAllItems'));
    expect(bloco).toContain("kind: 'expense'");
    expect(bloco).toContain("kind: 'debt'");
    expect(bloco).toContain("kind: 'invoice'");
  });

  test('fatura é paga pelo mesmo caminho do lote (uma transação só)', () => {
    const fn = quick.slice(quick.indexOf('async function payExpense()'));
    expect(fn.slice(0, 1400)).toContain('paymentsApi.payBatch');
  });

  test('o backend traz atrasadas de meses anteriores nas duas listas', () => {
    const payments = read('src/modules/payments/payments.service.js');
    // Contas e parcelas: mês atual OU meses anteriores.
    const ocorrencias = (payments.match(/\{ monthId \}/g) || []).length;
    expect(ocorrencias).toBeGreaterThanOrEqual(2); // bills e debts
    expect(payments).toContain('year: { lt: targetMonth?.year ?? 0 }');
  });

  test('a automação usa a MESMA função de listagem', () => {
    const auto = read('src/modules/automations/automations.service.js');
    expect(auto).toContain('paymentsService.getPayableItems');
  });
});
