import { formatCurrency } from '../lib/format';

const TONE_CLASSES = {
  neutral: 'text-ink',
  positive: 'text-pine',
  negative: 'text-terracotta',
};

export default function MetricCard({ label, value, tone = 'neutral' }) {
  return (
    <div className="border border-rule bg-surface px-4 py-3">
      <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-muted">{label}</p>
      <p className={`mt-1 font-mono text-xl tabular-nums ${TONE_CLASSES[tone]}`}>
        {formatCurrency(value)}
      </p>
    </div>
  );
}
