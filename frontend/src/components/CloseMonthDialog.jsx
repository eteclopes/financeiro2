import { formatCurrency } from '../lib/format';

export default function CloseMonthDialog({ preview, loading, onConfirm, onCancel, confirming }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4">
      <div className="w-full max-w-md border border-rule bg-surface p-6">
        <p className="font-mono text-xs uppercase tracking-[0.15em] text-muted">Fechamento mensal</p>
        <h2 className="mt-1 font-display text-2xl text-ink">Encerrar este mês?</h2>

        {loading || !preview ? (
          <p className="mt-4 text-sm text-muted">Carregando resumo…</p>
        ) : (
          <div className="mt-4 space-y-2 border-t border-rule pt-4 text-sm">
            <Row label="Contas pendentes" value={`${preview.pendingExpensesCount} (${formatCurrency(preview.pendingExpensesTotal)})`} />
            <Row label="Faturas em aberto" value={preview.openInvoicesCount} />
            <Row label="Metas ativas" value={preview.activeGoalsCount} />
            <Row label="Receitas recorrentes a gerar" value={preview.willGenerateNextMonth.recurringIncomes} />
            <Row label="Despesas fixas a gerar" value={preview.willGenerateNextMonth.fixedExpenses} />
            <Row label="Parcelas de dívida a gerar" value={preview.willGenerateNextMonth.debtInstallments} />
            <p className="pt-2 text-xs text-muted">
              Pendências não pagas continuam neste mês como histórico — nada é apagado ou duplicado.
            </p>
          </div>
        )}

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 border border-rule py-2 text-sm text-muted transition hover:text-ink"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirming || loading}
            className="flex-1 bg-pine py-2 text-sm font-medium text-paper transition hover:bg-pine-dark disabled:opacity-60"
          >
            {confirming ? 'Encerrando…' : 'Confirmar e encerrar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span className="font-mono tabular-nums text-ink">{value}</span>
    </div>
  );
}
