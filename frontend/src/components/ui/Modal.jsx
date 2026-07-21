import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './index';
import { Dropdown } from './Dropdown';

// ── Modal ──────────────────────────────────────────────────
export function Modal({ open, onClose, title, children, size = 'md' }) {
  const titleId = useId();
  const panelRef = useRef(null);
  const previouslyFocused = useRef(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    if (!open) return undefined;

    previouslyFocused.current = document.activeElement;
    const body = document.body;
    const html = document.documentElement;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyPaddingRight = body.style.paddingRight;
    const previousHtmlOverscroll = html.style.overscrollBehavior;
    const scrollbarWidth = Math.max(0, window.innerWidth - html.clientWidth);

    body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;
    html.style.overscrollBehavior = 'none';
    body.dataset.modalOpen = 'true';

    const focusPanel = window.requestAnimationFrame(() => {
      // Não focamos automaticamente o primeiro input. Em celulares isso abria
      // o teclado assim que o modal aparecia e deslocava toda a interface.
      panelRef.current?.focus?.({ preventScroll: true });
    });

    const handler = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }

      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handler);
    return () => {
      window.cancelAnimationFrame(focusPanel);
      document.removeEventListener('keydown', handler);
      body.style.overflow = previousBodyOverflow;
      body.style.paddingRight = previousBodyPaddingRight;
      html.style.overscrollBehavior = previousHtmlOverscroll;
      delete body.dataset.modalOpen;

      // Restaurar foco em campos de formulário no celular reabre o teclado
      // imediatamente após fechar o modal. Só devolvemos foco para controles
      // seguros (botões/links) ou em telas maiores.
      const previous = previouslyFocused.current;
      const isTextField = previous?.matches?.('input, textarea, select, [contenteditable="true"]');
      if (previous?.isConnected && (!isTextField || window.innerWidth >= 768)) {
        previous.focus?.({ preventScroll: true });
      } else {
        document.activeElement?.blur?.();
      }
    };
  }, [open]);

  if (!open) return null;

  const sizes = {
    sm: 'sm:max-w-[520px]',
    md: 'sm:max-w-[640px]',
    lg: 'sm:max-w-[760px]',
    xl: 'sm:max-w-[960px]',
  };

  return createPortal(
    <div className="modal-layer" role="presentation">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Fechar modal"
        className="modal-backdrop"
        onClick={() => onCloseRef.current?.()}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`modal-panel ${sizes[size] ?? sizes.md}`}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary-light/70 to-transparent" />
        <div className="pointer-events-none absolute -right-16 -top-20 h-36 w-36 rounded-full bg-primary/10 blur-3xl dark:bg-primary/15" />

        <div className="modal-header">
          <div className="min-w-0 pr-3">
            <h2 id={titleId} className="truncate text-base font-bold tracking-tight text-slate-950 dark:text-white sm:text-lg">{title}</h2>
          </div>
          <button
            type="button"
            onClick={() => onCloseRef.current?.()}
            aria-label="Fechar"
            className="modal-close"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

// ── ConfirmDialog ──────────────────────────────────────────
export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel = 'Confirmar', variant = 'danger', loading }) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <p className="mb-6 text-sm leading-relaxed text-muted">{description}</p>
      <div className="modal-actions">
        <Button variant="outline" onClick={onClose} disabled={loading}>Cancelar</Button>
        <Button variant={variant} onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
      </div>
    </Modal>
  );
}

// ── Form Group ─────────────────────────────────────────────
export function FormGroup({ label, htmlFor, error, children, required, hint }) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-zinc-300">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
        {hint && <span className="ml-1 text-xs font-normal text-muted">({hint})</span>}
      </label>
      {children}
      {error && <p role="alert" className="mt-1.5 flex items-center gap-1 text-xs text-danger">⚠ {error}</p>}
    </div>
  );
}

// ── Input / Select / Textarea ──────────────────────────────
export function Input({ className = '', ...props }) {
  return <input className={`input-base ${className}`} {...props} />;
}

export function Select({ children, className = '', ...props }) {
  return (
    <Dropdown className={className} {...props}>
      {children}
    </Dropdown>
  );
}

export function Textarea({ className = '', ...props }) {
  return <textarea className={`input-base resize-y ${className}`} rows={3} {...props} />;
}

// ── Table ──────────────────────────────────────────────────
export function Table({ columns, data, loading, empty }) {
  return (
    <div className="data-table-scroll rounded-2xl border border-slate-200/90 bg-white dark:border-white/[0.07] dark:bg-transparent">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-slate-50/95 backdrop-blur-sm dark:bg-[#171720]/95">
          <tr>
            {columns.map((col) => (
              <th key={col.key ?? col.label} className="table-header">{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200/70 dark:divide-white/[0.055]">
          {loading
            ? Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}>
                  {columns.map((col) => (
                    <td key={col.key ?? col.label} className="table-cell">
                      <div className="h-4 w-3/4 rounded-lg shimmer-bg" />
                    </td>
                  ))}
                </tr>
              ))
            : data.length === 0
              ? (
                <tr>
                  <td colSpan={columns.length} className="py-12 text-center text-sm text-muted">
                    {empty ?? 'Nenhum registro encontrado.'}
                  </td>
                </tr>
              )
              : data.map((row, i) => (
                  <tr key={row.id ?? i} className="transition-colors hover:bg-primary-subtle/45 dark:hover:bg-primary/[0.045]">
                    {columns.map((col) => (
                      <td key={col.key ?? col.label} className="table-cell">
                        {col.render ? col.render(row) : row[col.key]}
                      </td>
                    ))}
                  </tr>
                ))
          }
        </tbody>
      </table>
    </div>
  );
}
