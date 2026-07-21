// debts.service.js faz `require('../../config/prisma')` (direto e via
// expenses.service/months.service) logo no topo do arquivo — sem mockar
// isso primeiro, o require abaixo tentaria `new PrismaClient()` de verdade
// e quebraria (engine do Prisma não foi gerado neste ambiente).
jest.mock('../../src/config/prisma', () => require('../helpers/prismaMock').createPrismaMock());

const { computeInstallmentValue } = require('../../src/modules/debts/debts.service');

describe('computeInstallmentValue', () => {
  test('última parcela quita o saldo remanescente inteiro (mesmo que diferente do valor nominal)', () => {
    // 3 parcelas de 100 planejadas, mas sobrou 97.50 de saldo por causa de
    // arredondamentos anteriores — a última parcela tem que fechar em 97.50,
    // não em 100 (senão o saldo devedor nunca chegaria a zero exatamente).
    expect(computeInstallmentValue(97.5, 1, 100)).toBe(97.5);
  });

  test('parcela do meio usa o valor nominal quando o saldo é suficiente', () => {
    expect(computeInstallmentValue(250, 3, 100)).toBe(100);
  });

  test('nunca cobra mais do que o saldo remanescente, mesmo que o nominal seja maior', () => {
    // saldo de 50 restante, mas nominal calculado era 100 (ex: pagamento
    // antecipado reduziu o saldo) — a parcela não pode "inventar" dívida.
    expect(computeInstallmentValue(50, 2, 100)).toBe(50);
  });

  test('saldo remanescente zerado ou negativo nunca gera parcela negativa', () => {
    expect(computeInstallmentValue(-5, 1, 100)).toBe(0);
  });

  test('nominal negativo (não deveria acontecer, mas por segurança) nunca gera parcela negativa', () => {
    expect(computeInstallmentValue(100, 3, -10)).toBe(0);
  });

  describe('carryOver (ajuste por ter pago mais/menos que a parcela anterior)', () => {
    test('pagou a mais (carryOver negativo) reduz a próxima parcela pelo mesmo valor', () => {
      // pagou R$260 de uma parcela de R$200 -> excedente R$60 -> carryOver -60
      expect(computeInstallmentValue(2000, 5, 200, -60)).toBe(140);
    });

    test('pagou a menos (carryOver positivo) aumenta a próxima parcela pelo mesmo valor', () => {
      // pagou R$150 de uma parcela de R$200 -> faltou R$50 -> carryOver +50
      expect(computeInstallmentValue(2000, 5, 200, 50)).toBe(250);
    });

    test('carryOver não deixa a parcela negativa mesmo se o excedente for maior que o nominal', () => {
      expect(computeInstallmentValue(2000, 5, 200, -500)).toBe(0);
    });

    test('carryOver nunca faz a parcela passar do saldo devedor disponível', () => {
      expect(computeInstallmentValue(100, 5, 200, 50)).toBe(100);
    });

    test('carryOver não se aplica à parcela final — ela sempre quita o saldo inteiro', () => {
      expect(computeInstallmentValue(97.5, 1, 100, 50)).toBe(97.5);
    });

    test('sem carryOver informado (parâmetro omitido), comportamento é idêntico ao de antes', () => {
      expect(computeInstallmentValue(250, 3, 100)).toBe(100);
    });
  });
});
