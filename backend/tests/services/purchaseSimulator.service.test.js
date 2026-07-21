jest.mock('../../src/config/prisma', () => require('../helpers/prismaMock').createPrismaMock());
jest.mock('../../src/modules/months/months.service');
jest.mock('../../src/modules/cards/cards.service');
jest.mock('../../src/modules/projections/projections.service');
jest.mock('../../src/modules/_shared/financialMetrics');

const monthsService = require('../../src/modules/months/months.service');
const cardsService = require('../../src/modules/cards/cards.service');
const projectionsService = require('../../src/modules/projections/projections.service');
const { getAverageRecentIncome } = require('../../src/modules/_shared/financialMetrics');
const { simulatePurchase, bestInstallmentPlan } = require('../../src/modules/simulators/purchaseSimulator.service');

beforeEach(() => {
  jest.clearAllMocks();
  monthsService.getMonthOrThrow.mockResolvedValue({ id: 1n, userId: 10n, month: 3, year: 2026 });
});

describe('bestInstallmentPlan (helper puro, reaproveitado por bestInstallments e waitUntil)', () => {
  test('devolve o menor N que mantém a faixa saudável', () => {
    // renda 5000, compromisso já existente 1000, compra de 2000: à vista
    // (n=1) dá ratio 0.6 (atenção); a partir de n=2 (parcela de 1000) o
    // ratio já cai para 0.4 (saudável, exatamente no limite da faixa).
    expect(bestInstallmentPlan(1000, 5000, 2000)).toMatchObject({ installments: 2 });
  });

  test('devolve null quando nem parcelando no máximo permitido cabe com saúde', () => {
    expect(bestInstallmentPlan(900, 1000, 2400, 12)).toBeNull();
  });

  test('sem renda média (avgIncome=0) e valor positivo, nunca é saudável', () => {
    expect(bestInstallmentPlan(0, 0, 100)).toBeNull();
  });
});

describe('simulatePurchase — limite do cartão bloqueia mesmo quando o parcelamento "resolveria" pela renda', () => {
  test('cartão com limite insuficiente: bestInstallments e waitUntil ficam null (não sugere parcelar/esperar como se o limite não existisse)', async () => {
    getAverageRecentIncome.mockResolvedValue(5000);
    projectionsService.projectMonths.mockResolvedValue([
      { month: 3, year: 2026, totalExpenses: 1000 },
    ]);
    cardsService.getOwnedCardOrThrow.mockResolvedValue({ id: 7n, name: 'Cartão X', limitValue: 500 });
    cardsService.computeUsedLimit.mockResolvedValue(400); // disponível: 100

    const result = await simulatePurchase(10n, {
      monthId: 1n, description: 'Notebook', value: 2000, installments: 1, cardId: 7n,
    });

    // Só pela renda, parcelar em 2x já cairia em faixa saudável (ver teste
    // do helper acima) — mas o limite disponível (R$100) nunca comporta o
    // valor TOTAL da compra (R$2000), então nenhuma sugestão de
    // parcelamento ou espera deveria aparecer: o problema é o limite, não
    // o número de parcelas.
    expect(result.cardCheck).toMatchObject({ sufficient: false, availableLimit: 100 });
    expect(result.recommended).toBe(false);
    expect(result.bestInstallments).toBeNull();
    expect(result.waitUntil).toBeNull();
    expect(result.explanation).toMatch(/Limite insuficiente/);
  });
});

describe('simulatePurchase — bestInstallments', () => {
  test('sugere o menor parcelamento saudável quando a opção pedida (à vista) não é recomendada', async () => {
    getAverageRecentIncome.mockResolvedValue(5000);
    projectionsService.projectMonths.mockResolvedValue([
      { month: 3, year: 2026, totalExpenses: 1000 },
    ]);

    const result = await simulatePurchase(10n, {
      monthId: 1n, description: 'TV', value: 4000, installments: 1,
    });

    expect(result.recommended).toBe(false); // à vista: ratio 1.0 (crítico)
    expect(result.bestInstallments).toBe(4); // 4x de 1000 -> ratio 0.4 (saudável)
  });
});

describe('simulatePurchase — waitUntil (REGRESSÃO: precisa considerar parcelamento, não só pagar à vista)', () => {
  test('encontra um mês futuro saudável PARCELANDO mesmo quando pagar à vista nunca seria saudável em nenhum mês', async () => {
    getAverageRecentIncome.mockResolvedValue(1000);
    // Com renda de 1000 e compra de 2400, pagar à vista (n=1) dá ratio
    // 2400/1000=2.4 — sempre "crítico", em QUALQUER mês, não importa o
    // quão baixo esteja o compromisso já agendado. A versão antiga desta
    // busca só testava exatamente esse caso (n=1) e nunca encontraria
    // resposta aqui — a correção testa também parcelamentos.
    projectionsService.projectMonths.mockResolvedValue([
      { month: 3, year: 2026, totalExpenses: 900 }, // mês corrente: sem margem nem parcelando
      { month: 4, year: 2026, totalExpenses: 500 }, // ainda apertado
      { month: 5, year: 2026, totalExpenses: 150 }, // dívida quitada -> sobra espaço parcelando
    ]);

    const result = await simulatePurchase(10n, {
      monthId: 1n, description: 'Reforma', value: 2400, installments: 1,
    });

    expect(result.bestInstallments).toBeNull(); // mês corrente não resolve nem parcelando
    expect(result.waitUntil).toMatchObject({ month: 5, year: 2026, installments: 10 });
  });

  test('quando nenhum mês do horizonte resolve (nem parcelando), waitUntil é null', async () => {
    getAverageRecentIncome.mockResolvedValue(1000);
    projectionsService.projectMonths.mockResolvedValue([
      { month: 3, year: 2026, totalExpenses: 900 },
      { month: 4, year: 2026, totalExpenses: 900 },
    ]);

    const result = await simulatePurchase(10n, {
      monthId: 1n, description: 'Carro', value: 50000, installments: 1,
    });

    expect(result.bestInstallments).toBeNull();
    expect(result.waitUntil).toBeNull();
  });
});
