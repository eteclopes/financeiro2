function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function percentChange(from, to) {
  if (from === 0) return null;
  return round2(((to - from) / Math.abs(from)) * 100);
}

module.exports = { round2, clamp, percentChange };