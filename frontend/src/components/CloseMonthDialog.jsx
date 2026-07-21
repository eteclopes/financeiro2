import { formatCurrency } from '../lib/format';
import { Modal } from './ui/Modal';
import { Button, Skeleton } from './ui';

export default function CloseMonthDialog({ preview, loading, onConfirm, onCancel, confirming }) {
  return (
    <Modal open onClose={onCancel} title="Encerrar este mês?" size="sm">
      <div className="space-y-5">
        <p className="text-sm leading-relaxed text-muted">
          Revise o resumo antes de encerrar. Pendências continuam no histórico e nada é apagado.
        </p>

        {loading || !preview ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-11" />)}
          </div>
        ) : (
          <div className="space-y-2 rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3 dark:border-white/[0.07] dark:bg-white/[0.025]">
            <Row label="Contas pendentes" value={`${preview.pendingExpensesCount} (${formatCurrency(preview.pendingExpensesTotal)})`} />
            <Row label="Faturas em aberto" value={preview.openInvoicesCount} />
            <Row label="Metas ativas" value={preview.activeGoalsCount} />
            <Row label="Receitas recorrentes a gerar" value={preview.willGenerateNextMonth.recurringIncomes} />
            <Row label="Despesas fixas a gerar" value={preview.willGenerateNextMonth.fixedExpenses} />
            <Row label="Parcelas de dívida a gerar" value={preview.willGenerateNextMonth.debtInstallments} />
          </div>
        )}

        <div className="modal-actions">
          <Button variant="outline" onClick={onCancel} disabled={confirming}>Cancelar</Button>
          <Button onClick={onConfirm} disabled={loading} loading={confirming}>Confirmar e encerrar</Button>
        </div>
      </div>
    </Modal>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl bg-white px-3 py-2.5 dark:bg-white/[0.035]">
      <span className="min-w-0 text-sm text-muted">{label}</span>
      <span className="max-w-full break-words text-right font-mono text-sm font-bold tabular-nums text-slate-800 dark:text-zinc-100">{value}</span>
    </div>
  );
}
