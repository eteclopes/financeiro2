/**
 * Soma `delta` meses a um par (month 1-12, year), com rollover correto de ano.
 * Ex.: addMonths(11, 2026, 2) -> { month: 1, year: 2027 }
 */
function addMonths(month, year, delta) {
  const zeroBasedTotal = (month - 1) + delta;
  const newMonth = ((zeroBasedTotal % 12) + 12) % 12;
  const newYear = year + Math.floor(zeroBasedTotal / 12);
  return { month: newMonth + 1, year: newYear };
}

module.exports = { addMonths };
