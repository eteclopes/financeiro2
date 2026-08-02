jest.mock('../../src/config/prisma', () => require('../helpers/prismaMock').createPrismaMock());
// Controla "hoje" para o filtro de fronteira ser determinístico.
jest.mock('../../src/utils/dateTime', () => ({
  getCalendarDateParts: () => ({ month: 7, year: 2026 }), // julho/2026 fixo
}));

const prismaMock = require('../../src/config/prisma');
const { installDefaults } = require('../helpers/prismaMock');
const { listMonths } = require('../../src/modules/months/months.service');

beforeEach(() => installDefaults(prismaMock));

function m(id, month, year, status = 'open') {
  return { id: BigInt(id), userId: 10n, month, year, status, closedAt: null, createdAt: new Date() };
}

describe('listMonths — oculta meses futuros criados só por cartão', () => {
  test('sem nada fechado: mostra até o mês do calendário (hoje), oculta futuros', async () => {
    // desc por data, como o service ordena
    prismaMock.month.findMany.mockResolvedValue([
      m(4, 9, 2026), // setembro (só fatura de cartão)
      m(3, 8, 2026), // agosto (só fatura de cartão)
      m(2, 7, 2026), // julho (atual)
      m(1, 6, 2026, 'closed'),
    ]);

    const result = await listMonths(10n);
    const labels = result.map((x) => `${x.month}/${x.year}`);
    // fronteira = julho (hoje). Junho fechado, +1 = julho, não passa de julho.
    expect(labels).toEqual(['7/2026', '6/2026']);
    expect(labels).not.toContain('8/2026');
    expect(labels).not.toContain('9/2026');
  });

  test('após fechar julho, agosto (próximo) aparece; setembro continua oculto', async () => {
    prismaMock.month.findMany.mockResolvedValue([
      m(4, 9, 2026),               // setembro (cartão) -> oculto
      m(3, 8, 2026),               // agosto (próximo a trabalhar) -> visível
      m(2, 7, 2026, 'closed'),     // julho fechado
      m(1, 6, 2026, 'closed'),
    ]);

    const result = await listMonths(10n);
    const labels = result.map((x) => `${x.month}/${x.year}`);
    // último fechado = julho, +1 = agosto -> fronteira agosto.
    expect(labels).toContain('8/2026');
    expect(labels).not.toContain('9/2026');
  });

  test('meses passados e fechados sempre aparecem', async () => {
    prismaMock.month.findMany.mockResolvedValue([
      m(3, 7, 2026),
      m(2, 5, 2026, 'closed'),
      m(1, 3, 2026, 'closed'),
    ]);
    const result = await listMonths(10n);
    expect(result.map((x) => `${x.month}/${x.year}`)).toEqual(['7/2026', '5/2026', '3/2026']);
  });
});
