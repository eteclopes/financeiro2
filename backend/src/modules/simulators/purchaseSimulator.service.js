const monthsService = require('../months/months.service');
const cardsService = require('../cards/cards.service');
const projectionsService = require('../projections/projections.service');
const { getAverageRecentIncome } = require('../_shared/financialMetrics');
const { classifyCommitment } = require('../_shared/commitment');
const { round2 } = require('../../utils/math');
const { MONTH_NAMES } = require('../../utils/monthNames');

const LOOKAHEAD_MONTHS = 12;
const MAX_INSTALLMENTS_SUGGESTED = 12;

/**
 * Menor número de parcelas (1..maxInstallments) que mantém o comprometimento
 * de renda em faixa "saudável", supondo a compra iniciando no mês cujo
 * total de compromissos já agendados é `monthCommitment`. Devolve `null` se
 * nenhuma quantidade de parcelas (nem a mínima, 1x) chega a uma faixa
 * saudável — nesse caso parcelar mais não ajuda, o problema é a renda vs.
 * o valor da compra, não o número de parcelas.
 *
 * Reaproveitado tanto para "a melhor opção de parcelamento agora" quanto
 * para a busca de "aguardar até quando" (loop sobre os meses futuros, mais
 * abaixo em simulatePurchase) — os dois são, no fundo, a mesma pergunta
 * ("existe algum N de parcelas que cabe, começando neste mês?"), só que
 * aplicada a meses diferentes.
 */
function bestInstallmentPlan(monthCommitment, avgIncome, value, maxInstallments = MAX_INSTALLMENTS_SUGGESTED) {
  for (let n = 1; n <= maxInstallments; n += 1) {
    const installmentValue = n <= 1 ? value : round2(value / n);
    const ratio = avgIncome > 0 ? (monthCommitment + installmentValue) / avgIncome : installmentValue > 0 ? 1 : 0;
    if (classifyCommitment(ratio) === 'saudavel') {
      return { installments: n, installmentValue, ratio };
    }
  }
  return null;
}

async function simulatePurchase(userId, payload) {
  await monthsService.getMonthOrThrow(userId, payload.monthId);

  const [avgIncome, projection] = await Promise.all([
    getAverageRecentIncome(userId, payload.monthId, 3),
    projectionsService.projectMonths(userId, payload.monthId, LOOKAHEAD_MONTHS),
  ]);

  let cardCheck = null;
  if (payload.cardId) {
    const card = await cardsService.getOwnedCardOrThrow(userId, payload.cardId);
    const usedLimit = await cardsService.computeUsedLimit(card.id);
    const availableLimit = round2(Number(card.limitValue) - usedLimit);
    // O limite é consumido pelo VALOR TOTAL da compra assim que ela é
    // parcelada (todas as parcelas futuras já "reservam" limite de uma
    // vez — ver cardPurchases.service.js/computeUsedLimit), não apenas
    // pela parcela mensal. Por isso a suficiência do limite não muda
    // conforme o número de parcelas escolhido.
    cardCheck = { cardName: card.name, availableLimit, sufficient: payload.value <= availableLimit + 0.009 };
  }
  const cardIsBlocking = Boolean(cardCheck && !cardCheck.sufficient);

  // Compromissos já agendados (fixos + dívidas + cartão) para o mês
  // corrente, vindos da mesma projeção usada no resto do app — não inclui
  // gasto variável/eventual (não há como projetar isso, não tem molde).
  const existingCommitment = projection[0]?.totalExpenses ?? 0;

  function ratioFor(installments) {
    const installmentValue = installments <= 1 ? payload.value : round2(payload.value / installments);
    const ratio = avgIncome > 0 ? (existingCommitment + installmentValue) / avgIncome : installmentValue > 0 ? 1 : 0;
    return { installmentValue, ratio };
  }

  const requested = ratioFor(payload.installments);
  const requestedBand = classifyCommitment(requested.ratio);
  let recommended = requestedBand === 'saudavel' || requestedBand === 'atencao';
  if (cardIsBlocking) recommended = false;

  // Melhor parcelamento agora (mês corrente) — menor número de parcelas
  // que ainda mantém a faixa "saudável", preferindo quitar rápido em vez
  // de esticar ao máximo. Se o limite do cartão já é insuficiente para o
  // valor TOTAL da compra, nenhuma quantidade de parcelas resolve isso
  // (o limite não depende de quantas parcelas — ver nota acima), então
  // nem sugerimos: sugerir "6x" quando o cartão não comporta a compra
  // daria a falsa impressão de que há um caminho parcelando mais.
  const bestPlan = cardIsBlocking ? null : bestInstallmentPlan(existingCommitment, avgIncome, payload.value);
  const bestInstallments = bestPlan?.installments ?? null;

  // Se nem o melhor parcelamento agora cabe com saúde (ou o cartão bloqueia
  // de cara), procura no horizonte de 12 meses o primeiro mês em que ALGUM
  // parcelamento (1x a 12x) cabe — não apenas pagar à vista. Antes, esta
  // busca só testava "dá para pagar tudo de uma vez nesse mês?", um teste
  // bem mais rígido do que o propósito da ferramenta (parcelar), que
  // raramente encontrava resposta para compras de valor mais alto.
  let waitUntil = null;
  if (!bestInstallments) {
    for (const month of projection.slice(1)) {
      const plan = bestInstallmentPlan(month.totalExpenses, avgIncome, payload.value);
      if (plan) {
        waitUntil = { month: month.month, year: month.year, installments: plan.installments };
        break;
      }
    }
  }

  const annualImpact = round2(Math.min(payload.installments, 12) * requested.installmentValue);

  return {
    description: payload.description,
    value: payload.value,
    installments: payload.installments,
    installmentValue: requested.installmentValue,
    monthlyCommitmentRatio: round2(requested.ratio * 100),
    commitmentBand: requestedBand,
    recommended,
    cardCheck,
    bestInstallments,
    waitUntil,
    monthlyImpact: requested.installmentValue,
    annualImpact,
    explanation: buildExplanation({ recommended, requestedBand, cardCheck, bestInstallments, waitUntil, payload }),
  };
}

function buildExplanation({ recommended, requestedBand, cardCheck, bestInstallments, waitUntil, payload }) {
  if (cardCheck && !cardCheck.sufficient) {
    return `Limite insuficiente no cartão (disponível: ${cardCheck.availableLimit.toFixed(2)}).`;
  }
  if (recommended) {
    return requestedBand === 'saudavel'
      ? 'Pode comprar — o comprometimento da renda fica em faixa saudável.'
      : 'Pode comprar com atenção — o comprometimento fica em faixa de atenção, mas ainda controlado.';
  }
  if (bestInstallments && bestInstallments !== payload.installments) {
    return `Não recomendamos nessa condição. Melhor opção: ${bestInstallments}x de ${round2(payload.value / bestInstallments).toFixed(2)}.`;
  }
  if (waitUntil) {
    return `Não recomendamos comprar agora. Recomendamos aguardar até ${MONTH_NAMES[waitUntil.month]}/${waitUntil.year}` +
      (waitUntil.installments > 1 ? `, parcelando em ${waitUntil.installments}x.` : ', pagando à vista.');
  }
  return 'Não recomendamos comprar neste momento — compromete demais a renda nos próximos meses.';
}

module.exports = { simulatePurchase, bestInstallmentPlan };
