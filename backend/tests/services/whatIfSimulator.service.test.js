jest.mock('../../src/config/prisma', () => require('../helpers/prismaMock').createPrismaMock());

const prismaMock = require('../../src/config/prisma');
const { installDefaults } = require('../helpers/prismaMock');
const AppError = require('../../src/utils/AppError');
const { deleteSimulation, runScenarioPreview } = require('../../src/modules/simulators/whatIfSimulator.service');

beforeEach(() => installDefaults(prismaMock));

/**
 * Cenário-base reutilizado pelos testes de pay_debt/anticipate_installments:
 * dívida de R$1.200 em 12x de R$100, criada em janeiro/2026. Até "agora"
 * (março/2026, mês índice 0 da projeção) já foram geradas 3 parcelas reais
 * (jan/fev/mar), nenhuma paga ainda (remainingBalance segue em 1200).
 * Renda recorrente R$5.000/mês, despesas fixas R$1.500/mês, sem cartão.
 */
function installDebtScenarioMocks() {
  prismaMock.month.findFirst.mockResolvedValue({ id: 1n, userId: 10n, month: 3, year: 2026 });
  prismaMock.debt.findMany.mockResolvedValue([
    { id: 5n, userId: 10n, status: 'active', remainingBalance: 1200, installmentsCount: 12, installmentValue: 100 },
  ]);
  prismaMock.debt.findFirst.mockResolvedValue({
    id: 5n, userId: 10n, status: 'active', remainingBalance: 1200, installmentsCount: 12, installmentValue: 100,
  });
  prismaMock.expense.findMany.mockResolvedValue([
    { value: 100, month: { month: 1, year: 2026 } },
    { value: 100, month: { month: 2, year: 2026 } },
    { value: 100, month: { month: 3, year: 2026 } },
  ]);
  prismaMock.incomeTemplate.aggregate.mockResolvedValue({ _sum: { value: 5000 } });
  prismaMock.fixedExpenseTemplate.aggregate.mockResolvedValue({ _sum: { value: 1500 } });
  prismaMock.month.findUnique.mockResolvedValue(null); // sem faturas de cartão
}

describe('runScenarioPreview — pay_debt (REGRESSÃO: custo à vista precisa aparecer no mês 0)', () => {
  test('quitar a dívida cobra o saldo devedor inteiro no mês corrente, não "de graça"', async () => {
    installDebtScenarioMocks();

    const result = await runScenarioPreview(10n, 1n, 'pay_debt', { debtId: '5' }, 12);

    // Mês 0 (março): baseline paga só a parcela normal (R$100); no cenário,
    // paga o saldo devedor inteiro (R$1200) — o net piora em R$1100 (=
    // 1200 - 100), não fica igual/melhor como acontecia antes da correção.
    expect(result.comparison[0].difference).toBeCloseTo(-1100, 2);

    // Ao longo de TODO o prazo restante da dívida (cabe dentro dos 12
    // meses simulados), o ganho total tende a ZERO: este sistema não
    // modela juros, então quitar antecipado não cria nem destrói valor —
    // só muda QUANDO o dinheiro sai do bolso. Um totalGain claramente
    // positivo aqui seria o sintoma do bug antigo (benefício sem custo).
    expect(result.totalGain).toBeCloseTo(0, 2);
  });

  test('dívida inexistente ou de outro usuário lança 404 (antes: no-op silencioso, devolvia "sem diferença nenhuma")', async () => {
    installDebtScenarioMocks();
    prismaMock.debt.findFirst.mockResolvedValue(null);

    const promise = runScenarioPreview(10n, 1n, 'pay_debt', { debtId: '999' }, 12);

    await expect(promise).rejects.toBeInstanceOf(AppError);
    await expect(promise).rejects.toMatchObject({ statusCode: 404, code: 'DEBT_NOT_FOUND' });
  });
});

describe('runScenarioPreview — cenários simples (increase_income / save_monthly)', () => {
  test('increase_income aumenta o net projetado todo mês pelo valor informado', async () => {
    installDebtScenarioMocks();
    prismaMock.debt.findMany.mockResolvedValue([]); // sem dívidas, para isolar o efeito da renda
    prismaMock.expense.findMany.mockResolvedValue([]);

    const result = await runScenarioPreview(10n, 1n, 'increase_income', { amount: 300 }, 6);

    expect(result.comparison.every((m) => m.difference === 300)).toBe(true);
    expect(result.totalGain).toBeCloseTo(300 * 6, 2);
  });

  test('save_monthly reduz o net projetado todo mês (o dinheiro vai para a reserva, não desaparece)', async () => {
    installDebtScenarioMocks();
    prismaMock.debt.findMany.mockResolvedValue([]);
    prismaMock.expense.findMany.mockResolvedValue([]);

    const result = await runScenarioPreview(10n, 1n, 'save_monthly', { amount: 150 }, 6);

    expect(result.comparison.every((m) => m.difference === -150)).toBe(true);
    expect(result.totalReserved).toBe(900);
    expect(result.availableBalanceImpact).toBe(-900);
    expect(result.totalWealthImpact).toBe(0);
    expect(result.comparison.at(-1).scenarioTotalCumulative).toBeCloseTo(
      result.comparison.at(-1).baselineCumulative,
      2
    );
  });
});

describe('runScenarioPreview — anticipate_installments (REGRESSÃO: valor antecipado precisa custar algo hoje)', () => {
  test('antecipar R$200 cobra R$200 no mês corrente e reduz as parcelas futuras de acordo', async () => {
    installDebtScenarioMocks();

    const result = await runScenarioPreview(10n, 1n, 'anticipate_installments', { debtId: '5', amount: 200 }, 12);

    // Mês 0: paga a parcela normal (R$100) MAIS os R$200 antecipados = R$300
    // no total, contra R$100 no baseline — piora de R$200 no mês corrente.
    expect(result.comparison[0].difference).toBeCloseTo(-200, 2);

    // De novo, sem juros modelados, o total ao longo de todo o prazo
    // restante da dívida tende a zero (só muda o "quando", não o "quanto").
    expect(result.totalGain).toBeCloseTo(0, 2);
  });

  test('antecipar mais do que o saldo devedor é clampado (equivale a quitar, nunca cobra a mais)', async () => {
    installDebtScenarioMocks();

    const result = await runScenarioPreview(10n, 1n, 'anticipate_installments', { debtId: '5', amount: 999999 }, 12);

    // Mesmo pedindo para antecipar um valor absurdamente maior que a
    // dívida, o custo no mês 0 nunca passa do saldo devedor real (R$1200
    // no total, dos quais R$100 já eram a parcela normal deste mês).
    expect(result.comparison[0].difference).toBeCloseTo(-1100, 2);
  });

  test('dívida inexistente ou de outro usuário lança 404', async () => {
    installDebtScenarioMocks();
    prismaMock.debt.findFirst.mockResolvedValue(null);

    const promise = runScenarioPreview(10n, 1n, 'anticipate_installments', { debtId: '999', amount: 100 }, 12);

    await expect(promise).rejects.toMatchObject({ statusCode: 404, code: 'DEBT_NOT_FOUND' });
  });
});

describe('deleteSimulation — fix 500 -> 404', () => {
  test('simulação existente e do usuário é apagada normalmente', async () => {
    prismaMock.simulation.findFirst.mockResolvedValue({ id: 1n, userId: 10n });
    prismaMock.simulation.delete.mockResolvedValue({ id: 1n });

    await expect(deleteSimulation(10n, 1n)).resolves.toBeUndefined();
    expect(prismaMock.simulation.delete).toHaveBeenCalledWith({ where: { id: 1n } });
  });

  test('REGRESSÃO: simulação inexistente/de outro usuário lança AppError 404 (não mais Error genérico -> 500)', async () => {
    prismaMock.simulation.findFirst.mockResolvedValue(null);

    const promise = deleteSimulation(10n, 999n);

    await expect(promise).rejects.toBeInstanceOf(AppError);
    await expect(promise).rejects.toMatchObject({ statusCode: 404, code: 'SIMULATION_NOT_FOUND' });
    expect(prismaMock.simulation.delete).not.toHaveBeenCalled();
  });
});
