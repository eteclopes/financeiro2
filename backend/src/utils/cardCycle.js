const { addMonths } = require('./monthMath');

function clampDay(year, month, day) {
  const lastDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return new Date(Date.UTC(Number(year), Number(month) - 1, Math.min(Number(day), lastDay)));
}

/**
 * O mês de referência é o ciclo que FECHA naquele mês.
 * Compra até o dia de fechamento (inclusive) entra nesse ciclo;
 * compra depois do fechamento entra no ciclo do mês seguinte.
 */
function firstInvoiceReference(purchaseDate, closingDay) {
  const date = purchaseDate instanceof Date ? purchaseDate : new Date(purchaseDate);
  const day = date.getUTCDate();
  const month = date.getUTCMonth() + 1;
  const year = date.getUTCFullYear();
  if (day <= Number(closingDay)) return { month, year };
  return addMonths(month, year, 1);
}

/**
 * Se o vencimento vem depois do fechamento, ele pertence ao mesmo mês
 * da referência. Se vem antes/igual, vence no mês seguinte.
 */
function invoiceDates(refMonth, refYear, closingDay, dueDay) {
  const closingDate = clampDay(refYear, refMonth, closingDay);
  const dueReference = Number(dueDay) <= Number(closingDay)
    ? addMonths(refMonth, refYear, 1)
    : { month: Number(refMonth), year: Number(refYear) };
  const dueDate = clampDay(dueReference.year, dueReference.month, dueDay);
  return { closingDate, dueDate };
}

function resolveInvoiceForPurchase(purchaseDate, closingDay, dueDay) {
  const reference = firstInvoiceReference(purchaseDate, closingDay);
  return { reference, ...invoiceDates(reference.month, reference.year, closingDay, dueDay) };
}

module.exports = { clampDay, firstInvoiceReference, invoiceDates, resolveInvoiceForPurchase };
