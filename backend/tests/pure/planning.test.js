jest.mock('../../src/config/prisma', () => require('../helpers/prismaMock').createPrismaMock());

const {
  estimateCardPurchaseWindow,
  buildGoalPlan,
  buildDebtPlan,
} = require('../../src/modules/planning/planning.service');

describe('Central de planejamento Pro', () => {
  test('compra depois do fechamento vai para a próxima janela do cartão', () => {
    const result = estimateCardPurchaseWindow(
      { closingDay: 10, dueDay: 20 },
      new Date(Date.UTC(2026, 6, 15))
    );
    expect(result.closingDate.toISOString().slice(0, 10)).toBe('2026-08-10');
    expect(result.dueDate.toISOString().slice(0, 10)).toBe('2026-08-20');
    expect(result.daysUntilDue).toBe(36);
  });

  test('meta calcula aporte recomendado sem contar retiradas como progresso', () => {
    const result = buildGoalPlan({
      id: 1n,
      name: 'Reserva',
      targetValue: 12000,
      targetDate: new Date(Date.UTC(2027, 0, 21)),
      contributions: [
        { type: 'contribution', value: 3000, contributionDate: new Date(Date.UTC(2026, 5, 1)) },
        { type: 'refund', value: 500, contributionDate: new Date(Date.UTC(2026, 6, 1)) },
      ],
    }, new Date(Date.UTC(2026, 6, 21)));

    expect(result.progress).toBe(2500);
    expect(result.remaining).toBe(9500);
    expect(result.recommendedMonthly).toBeCloseTo(1357.14, 2);
    expect(result.status).toBe('behind');
  });

  test('bola de neve ordena dívidas pelo menor saldo e preserva compromisso mensal', () => {
    const result = buildDebtPlan([
      { id: 1n, status: 'active', description: 'Maior', remainingBalance: 5000, installmentValue: 500, flexiblePayment: false, category: null },
      { id: 2n, status: 'active', description: 'Menor', remainingBalance: 900, installmentValue: 300, flexiblePayment: true, category: { name: 'Empréstimo' } },
      { id: 3n, status: 'settled', description: 'Quitada', remainingBalance: 0, installmentValue: 100, flexiblePayment: false, category: null },
    ]);

    expect(result.activeCount).toBe(2);
    expect(result.totalRemaining).toBe(5900);
    expect(result.monthlyCommitment).toBe(800);
    expect(result.snowballOrder.map((item) => item.description)).toEqual(['Menor', 'Maior']);
  });
});
