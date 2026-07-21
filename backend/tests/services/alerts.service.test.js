jest.mock('../../src/config/prisma', () => require('../helpers/prismaMock').createPrismaMock());
jest.mock('../../src/modules/months/months.service');
jest.mock('../../src/modules/savings/savings.service');
jest.mock('../../src/modules/cards/cards.service');
jest.mock('../../src/modules/_shared/financialMetrics');

const prismaMock = require('../../src/config/prisma');
const { installDefaults } = require('../helpers/prismaMock');
const monthsService = require('../../src/modules/months/months.service');
const savingsService = require('../../src/modules/savings/savings.service');
const cardsService = require('../../src/modules/cards/cards.service');
const { getAllMonthsChronological } = require('../../src/modules/_shared/financialMetrics');
const { refreshAlerts } = require('../../src/modules/alerts/alerts.service');

const MONTH = { id: 1n, userId: 10n, month: 7, year: 2026 };

beforeEach(() => {
  jest.clearAllMocks();
  installDefaults(prismaMock);
  monthsService.getMonthOrThrow.mockResolvedValue(MONTH);
  getAllMonthsChronological.mockResolvedValue([MONTH]);
  savingsService.getCurrentBalance.mockResolvedValue(0);
  cardsService.computeUsedLimitsByCard.mockResolvedValue(new Map());
  prismaMock.card.findMany.mockResolvedValue([]);
  prismaMock.goal.findMany.mockResolvedValue([]);
  prismaMock.income.aggregate.mockResolvedValue({ _sum: { value: 5000 } });
  prismaMock.expense.aggregate.mockImplementation(({ where }) => {
    // A mesma função `expense.aggregate` é chamada em pontos diferentes de
    // gatherContext (despesas do mês, dívida nova/paga, despesa recente
    // p/ reserva) — diferencia pelo formato do `where` recebido.
    if (where?.type === 'priority') return Promise.resolve({ _sum: { paidAmount: 0 } });
    return Promise.resolve({ _sum: { value: 0, paidAmount: 0 } });
  });
  prismaMock.expense.count.mockResolvedValue(0); // sem contas atrasadas, por padrão
  prismaMock.debt.aggregate.mockResolvedValue({ _sum: { totalValue: 0 } });
  prismaMock.expense.findMany.mockResolvedValue([]); // sem contas a vencer, por padrão

  // `refreshAlerts` devolve o resultado de uma leitura do banco DEPOIS do
  // upsert, não a lista calculada em memória diretamente — então o mock
  // precisa simular minimamente esse comportamento: `upsert` "grava" (guarda
  // num array local) e a leitura final devolve o que foi gravado. Sem isso,
  // mockar `alert.findMany` para um valor fixo desconecta o teste da lógica
  // que ele deveria estar validando (foi exatamente o que aconteceu na
  // primeira versão deste arquivo).
  let stored = [];
  prismaMock.alert.findMany.mockImplementation(({ where }) => {
    if (where && 'resolvedAt' in where) return Promise.resolve([]); // nenhum alerta pré-existente nestes testes
    return Promise.resolve(stored);
  });
  prismaMock.alert.upsert.mockImplementation(({ create }) => {
    const row = { id: BigInt(stored.length + 1), resolvedAt: null, createdAt: new Date(), ...create };
    stored.push(row);
    return Promise.resolve(row);
  });
});

function daysFromNow(n) {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000);
}

describe('refreshAlerts — regra nova: contas a vencer nos próximos 7 dias', () => {
  test('sem nenhuma conta a vencer, não gera o alerta upcoming_bills', async () => {
    const triggered = await refreshAlerts(10n, MONTH.id);
    expect(triggered.some((a) => a.type === 'upcoming_bills')).toBe(false);
  });

  test('conta vencendo em 5 dias gera alerta "warning" citando a conta pelo nome', async () => {
    prismaMock.expense.findMany.mockResolvedValue([
      { id: 1n, description: 'Aluguel', value: 1200, dueDate: daysFromNow(5) },
    ]);

    const triggered = await refreshAlerts(10n, MONTH.id);
    const alert = triggered.find((a) => a.type === 'upcoming_bills');

    expect(alert).toBeDefined();
    expect(alert.severity).toBe('warning');
    expect(alert.message).toContain('Aluguel');
    expect(alert.message).toMatch(/em 5 dias/);
  });

  test('conta vencendo em até 2 dias gera alerta "critical" (mesmo padrão de urgência do alerta de cartão)', async () => {
    prismaMock.expense.findMany.mockResolvedValue([
      { id: 1n, description: 'Internet', value: 120, dueDate: daysFromNow(1) },
    ]);

    const triggered = await refreshAlerts(10n, MONTH.id);
    const alert = triggered.find((a) => a.type === 'upcoming_bills');

    expect(alert.severity).toBe('critical');
    expect(alert.message).toMatch(/amanhã/);
  });

  test('várias contas a vencer: cita a mais próxima e resume o total das demais', async () => {
    prismaMock.expense.findMany.mockResolvedValue([
      { id: 1n, description: 'Água', value: 80, dueDate: daysFromNow(3) },
      { id: 2n, description: 'Luz', value: 150, dueDate: daysFromNow(6) },
    ]);

    const triggered = await refreshAlerts(10n, MONTH.id);
    const alert = triggered.find((a) => a.type === 'upcoming_bills');

    expect(alert.message).toContain('Água'); // a mais próxima (3 dias) vem primeiro
    expect(alert.message).toMatch(/\+1 outra/);
  });

  test('conta já atrasada não entra no alerta de "a vencer" (isso é o alerta late_bills, separado)', async () => {
    // status 'late' nunca aparece no resultado de `upcoming_bills` porque a
    // própria query do serviço filtra status IN (pending, partial) — aqui
    // simulamos o retorno já filtrado (o mock de findMany é o comportamento
    // esperado da query, não a query em si).
    prismaMock.expense.findMany.mockResolvedValue([]);
    prismaMock.expense.count.mockResolvedValue(2); // 2 contas atrasadas

    const triggered = await refreshAlerts(10n, MONTH.id);

    expect(triggered.some((a) => a.type === 'upcoming_bills')).toBe(false);
    expect(triggered.some((a) => a.type === 'late_bills')).toBe(true);
  });
});
