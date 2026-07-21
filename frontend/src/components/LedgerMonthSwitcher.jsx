import { formatMonthLabel } from '../lib/format';

export default function LedgerMonthSwitcher({ month, onPrev, onNext, canPrev, canNext, isOpen }) {
  return (
    <div className="border-y border-rule py-5">
      <div className="flex items-center justify-center gap-6">
        <button
          type="button"
          aria-label="Mês anterior"
          onClick={onPrev}
          disabled={!canPrev}
          className="font-display text-xl text-muted transition hover:text-ink disabled:opacity-30"
        >
          ‹
        </button>

        <div className="text-center">
          <p className="font-display text-3xl text-ink">{formatMonthLabel(month)}</p>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
            {isOpen ? 'mês aberto' : 'mês encerrado · histórico'}
          </p>
        </div>

        <button
          type="button"
          aria-label="Próximo mês"
          onClick={onNext}
          disabled={!canNext}
          className="font-display text-xl text-muted transition hover:text-ink disabled:opacity-30"
        >
          ›
        </button>
      </div>
    </div>
  );
}
