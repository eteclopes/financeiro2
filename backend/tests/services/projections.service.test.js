jest.mock('../../src/config/prisma', () => require('../helpers/prismaMock').createPrismaMock());
jest.mock('../../src/modules/months/months.service');

const prismaMock = require('../../src/config/prisma');
const { installDefaults } = require('../helpers/prismaMock');
const monthsService = require('../../src/modules/months/months.service');
const { getSingleDebtSchedule, getProjectionComponents } = require('../../src/modules/projections/projections.service');

beforeEach(() => installDefaults(prismaMock));

/**
 * Helper para simular o retorno de `prisma.expense.findMany` com parcelas
 * já geradas para uma dívida, uma por mês.
 */
function realInstallment(value, month, year) {
  return { value, month: { month, year } };
}

describe('getSingleDebtSchedule — alinhamento de meses (REGRESSÃO)', () => {
  test('mês corrente (índice 0) já com parcela gerada usa o valor REAL, não uma parcela recalculada do mês seguinte', async () => {
    // Dívida de 1200 em 12x de 100, criada em janeiro. Jan/Fev/Mar já têm
    // parcela gerada (3 no total) — estamos "agora" em março, nada pago.
    prismaMock.expense.findMany.mockResolvedValue([
      realInstallment(100, 1, 2026),
      realInstallment(100, 2, 2026),
      realInstallment(100, 3, 2026),
    ]);
    const debt = { id: 1n, remainingBalance: 1200, installmentsCount: 12, installmentValue: 100 };
    const months = Array.from({ length: 12 }, (_, i) => ({ month: 3 + i > 12 ? (3 + i) - 12 : 3 + i, year: 3 + i > 12 ? 2027 : 2026 }));

    const schedule = await getSingleDebtSchedule(debt, months);

    // Índice 0 = março = mês corrente: deve ser o valor REAL (100), vindo
    // do lookup — antes da correção, este índice mostrava a parcela
    // recalculada do mês SEGUINTE (abril), desalinhando tudo em 1 mês.
    expect(schedule[0]).toBe(100);
  });

  test('a última parcela (que absorve o saldo residual) aparece no mês certo, não um mês antes', async () => {
    prismaMock.expense.findMany.mockResolvedValue([
      realInstallment(100, 1, 2026),
      realInstallment(100, 2, 2026),
      realInstallment(100, 3, 2026),
    ]);
    const debt = { id: 1n, remainingBalance: 1200, installmentsCount: 12, installmentValue: 100 };
    const months = [
      { month: 3, year: 2026 }, { month: 4, year: 2026 }, { month: 5, year: 2026 },
      { month: 6, year: 2026 }, { month: 7, year: 2026 }, { month: 8, year: 2026 },
      { month: 9, year: 2026 }, { month: 10, year: 2026 }, { month: 11, year: 2026 },
      { month: 12, year: 2026 }, { month: 1, year: 2027 }, { month: 2, year: 2027 },
    ];

    const schedule = await getSingleDebtSchedule(debt, months);

    // 12 parcelas ao todo, 3 já geradas (jan/fev/mar) => a 12a (final) cai em
    // dezembro (índice 9): 3 (já geradas) + 9 (restantes: abr..dez) = 12.
    // A dívida termina exatamente em dezembro, e é ali que o resíduo (R$300,
    // já que 1200 - 100 de março - 8x100 de abr..nov = 300) deve aparecer.
    expect(schedule[9]).toBeCloseTo(300, 2); // dezembro = parcela final
    expect(schedule[10]).toBe(0); // janeiro/ano2: dívida já quitada
    expect(schedule[11]).toBe(0);

    // Soma de tudo deve bater exatamente com o saldo devedor atual (nada
    // foi pago ainda) — nenhum valor pode ter sido perdido ou duplicado.
    const total = schedule.reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1200, 2);
  });

  test('mês futuro sem nenhuma parcela gerada ainda projeta pela fórmula normalmente (comportamento inalterado)', async () => {
    prismaMock.expense.findMany.mockResolvedValue([]); // dívida recém-criada, nada gerado
    const debt = { id: 1n, remainingBalance: 300, installmentsCount: 3, installmentValue: 100 };
    const months = [{ month: 1, year: 2026 }, { month: 2, year: 2026 }, { month: 3, year: 2026 }];

    const schedule = await getSingleDebtSchedule(debt, months);

    expect(schedule).toEqual([100, 100, 100]);
  });

  test('remainingBalanceOverride (usado pelo simulador E Se) só afeta os meses ainda não gerados — meses reais continuam com o valor real', async () => {
    prismaMock.expense.findMany.mockResolvedValue([realInstallment(100, 3, 2026)]);
    const debt = { id: 1n, remainingBalance: 1200, installmentsCount: 12, installmentValue: 100 };
    const months = [{ month: 3, year: 2026 }, { month: 4, year: 2026 }, { month: 5, year: 2026 }];

    // Mesmo simulando uma antecipação que reduz o saldo hipotético para 50,
    // março (já gerado de verdade) continua mostrando 100 — não é
    // recalculado por um saldo hipotético que só vale "dali para frente".
    const schedule = await getSingleDebtSchedule(debt, months, 50);

    expect(schedule[0]).toBe(100);
  });
});

describe('getProjectionComponents — integração com a janela de meses corrigida', () => {
  beforeEach(() => {
    monthsService.getMonthOrThrow.mockResolvedValue({ id: 1n, userId: 10n, month: 3, year: 2026 });
  });

  test('debtSchedule[0] reflete a parcela real do mês corrente quando ela já existe', async () => {
    prismaMock.debt.findMany.mockResolvedValue([
      { id: 1n, remainingBalance: 1200, installmentsCount: 12, installmentValue: 100 },
    ]);
    prismaMock.expense.findMany.mockResolvedValue([realInstallment(100, 3, 2026)]);
    prismaMock.month.findUnique.mockResolvedValue(null); // sem faturas de cartão neste teste

    const components = await getProjectionComponents(10n, 1n, 3);

    expect(components.debtSchedule[0]).toBe(100);
  });
});
