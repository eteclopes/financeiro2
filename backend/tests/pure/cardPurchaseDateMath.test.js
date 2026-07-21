jest.mock('../../src/config/prisma', () => require('../helpers/prismaMock').createPrismaMock());
jest.mock('../../src/modules/months/months.service');
jest.mock('../../src/modules/expenses/expenses.service');
jest.mock('../../src/modules/cards/cards.service');

const { firstInvoiceReference, clampDay, invoiceDates } = require('../../src/modules/cards/cardPurchases.service');

describe('firstInvoiceReference', () => {
  // Regra textual do projeto: "compra dia 10, fechamento dia 20 -> fatura
  // atual; compra dia 25 -> fatura seguinte."
  test('compra ANTES do fechamento cai na fatura do mês corrente', () => {
    const purchase = new Date(Date.UTC(2026, 6, 10)); // 10/jul/2026, fechamento dia 20
    expect(firstInvoiceReference(purchase, 20)).toEqual({ month: 7, year: 2026 });
  });

  test('compra NO DIA do fechamento ainda cai na fatura do mês corrente (regra é <=)', () => {
    const purchase = new Date(Date.UTC(2026, 6, 20));
    expect(firstInvoiceReference(purchase, 20)).toEqual({ month: 7, year: 2026 });
  });

  test('compra DEPOIS do fechamento cai na fatura do mês seguinte', () => {
    const purchase = new Date(Date.UTC(2026, 6, 25));
    expect(firstInvoiceReference(purchase, 20)).toEqual({ month: 8, year: 2026 });
  });

  test('compra em dezembro depois do fechamento vira fatura de janeiro do ano seguinte', () => {
    const purchase = new Date(Date.UTC(2026, 11, 25)); // 25/dez/2026
    expect(firstInvoiceReference(purchase, 20)).toEqual({ month: 1, year: 2027 });
  });
});

describe('clampDay', () => {
  test('mantém o dia quando o mês tem dias suficientes', () => {
    const d = clampDay(2026, 3, 15);
    expect(d.getUTCDate()).toBe(15);
  });

  test('fevereiro não-bissexto: dia 30 é limitado ao último dia real do mês (28)', () => {
    const d = clampDay(2026, 2, 30); // 2026 não é bissexto
    expect(d.getUTCMonth()).toBe(1); // fevereiro (0-indexed)
    expect(d.getUTCDate()).toBe(28);
  });

  test('fevereiro bissexto: dia 30 é limitado a 29', () => {
    const d = clampDay(2028, 2, 30); // 2028 é bissexto
    expect(d.getUTCDate()).toBe(29);
  });

  test('mês de 31 dias com fechamento configurado no dia 31', () => {
    const d = clampDay(2026, 1, 31);
    expect(d.getUTCDate()).toBe(31);
  });
});


describe('invoiceDates — vencimento real da fatura', () => {
  test('vencimento anterior ao fechamento cai no mês seguinte', () => {
    const { closingDate, dueDate } = invoiceDates(7, 2026, 20, 5);
    expect(closingDate.toISOString().slice(0, 10)).toBe('2026-07-20');
    expect(dueDate.toISOString().slice(0, 10)).toBe('2026-08-05');
  });

  test('vencimento posterior ao fechamento permanece no mês da referência', () => {
    const { dueDate } = invoiceDates(7, 2026, 10, 25);
    expect(dueDate.toISOString().slice(0, 10)).toBe('2026-07-25');
  });

  test('virada de dezembro para janeiro preserva o ano correto', () => {
    const { dueDate } = invoiceDates(12, 2026, 20, 5);
    expect(dueDate.toISOString().slice(0, 10)).toBe('2027-01-05');
  });
});
