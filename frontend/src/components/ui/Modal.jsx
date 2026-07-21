import { useEffect, useId, useRef } from 'react';
import { Button } from './index';
import { Dropdown } from './Dropdown';

// ── Modal ──────────────────────────────────────────────────
export function Modal({ open, onClose, title, children, size = 'md' }) {
  const titleId = useId();
  const panelRef = useRef(null);
  const previouslyFocused = useRef(null);

  // `onClose` normalmente chega como função inline (ex: `onClose={() =>
  // setModalOpen(false)}`), recriada a cada render do componente pai —
  // inclusive a cada tecla digitada em um campo do formulário dentro do
  // modal. Guardamos a versão mais recente numa ref e usamos SÓ `open`
  // como dependência do efeito abaixo. Sem isso, o efeito (que move o
  // foco para dentro do modal) rodava de novo a cada digitação, e como
  // o botão "×" de fechar é o primeiro elemento focável do painel, o
  // foco "pulava" do campo de texto direto para o botão de fechar a
  // cada segunda tecla — fazendo o usuário perder o que estava digitando.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (e.key === 'Escape') { onCloseRef.current(); return; }
      // Trap de foco simples: Tab/Shift+Tab não devem "vazar" para elementos
      // atrás do modal (o overlay cobre a tela, mas não impede foco via
      // teclado sem isto). Antes, um usuário de teclado/leitor de tela podia
      // dar Tab e sair do modal sem fechar — agora o foco circula só dentro
      // do painel.
      if (e.key === 'Tab' && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';

    // Move o foco para dentro do modal ao abrir — sem isso, quem navega por
    // teclado/leitor de tela continua "focado" no botão que abriu o modal,
    // agora coberto pelo overlay. Guarda quem estava focado para devolver o
    // foco exatamente ali quando o modal fechar.
    // Prioriza um campo de formulário (input/select/textarea) sobre outros
    // elementos focáveis (como o botão de fechar) — o botão "×" costuma vir
    // primeiro no DOM, mas o usuário quer digitar, não fechar o modal.
    previouslyFocused.current = document.activeElement;
    const formField = panelRef.current?.querySelector('input, select, textarea');
    const anyFocusable = panelRef.current?.querySelector(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    (formField ?? anyFocusable ?? panelRef.current)?.focus();

    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  const sizes = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-2xl' };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-slate-950/55 dark:bg-black/70 backdrop-blur-md animate-fade-in" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative bg-white/95 dark:bg-[#1B1B26]/95 backdrop-blur-xl border border-white/70 dark:border-white/[0.08] w-full ${sizes[size]} rounded-t-[26px] sm:rounded-[22px] shadow-modal flex flex-col max-h-[90vh] animate-slide-up overflow-hidden`}>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary-light/70 to-transparent" />
        <div className="pointer-events-none absolute -right-16 -top-20 h-36 w-36 rounded-full bg-primary/10 blur-3xl dark:bg-primary/15" />
        <div className="relative flex items-center justify-between px-6 py-4.5 border-b border-slate-200/80 dark:border-white/[0.07] shrink-0">
          <h2 id={titleId} className="font-bold tracking-tight text-slate-950 dark:text-white">{title}</h2>
          <button onClick={onClose} aria-label="Fechar"
            className="h-9 w-9 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-900 hover:bg-slate-100 dark:text-zinc-500 dark:hover:bg-white/[0.06] dark:hover:text-white transition-colors text-xl leading-none">
            ×
          </button>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

// ── ConfirmDialog ──────────────────────────────────────────
export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel = 'Confirmar', variant = 'danger', loading }) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <p className="text-sm text-muted mb-6">{description}</p>
      <div className="flex flex-wrap gap-3 justify-end">
        <Button variant="outline" onClick={onClose} disabled={loading}>Cancelar</Button>
        <Button variant={variant} onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
      </div>
    </Modal>
  );
}

// ── Form Group ─────────────────────────────────────────────
export function FormGroup({ label, htmlFor, error, children, required, hint }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-semibold text-slate-700 dark:text-zinc-300 mb-1.5">
        {label}
        {required && <span className="text-danger ml-0.5">*</span>}
        {hint && <span className="text-muted font-normal ml-1 text-xs">({hint})</span>}
      </label>
      {children}
      {error && <p role="alert" className="mt-1.5 text-xs text-danger flex items-center gap-1">⚠ {error}</p>}
    </div>
  );
}

// ── Input / Select / Textarea ──────────────────────────────
export function Input({ className = '', ...props }) {
  return <input className={`input-base ${className}`} {...props} />;
}

// Select agora é um dropdown 100% customizado (ver components/ui/Dropdown.jsx)
// em vez do <select> nativo do navegador — a lista de opções aberta usa o
// tema (dark/light) e a animação do app, em vez do estilo do sistema
// operacional. A API pública (value/onChange/<option> filhos) continua
// idêntica, então nenhum dos ~24 lugares que já usam <Select> precisou mudar.
export function Select({ children, className = '', ...props }) {
  return (
    <Dropdown className={className} {...props}>
      {children}
    </Dropdown>
  );
}

export function Textarea({ className = '', ...props }) {
  return <textarea className={`input-base resize-none ${className}`} rows={3} {...props} />;
}

// ── Table ──────────────────────────────────────────────────
export function Table({ columns, data, loading, empty }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200/90 dark:border-white/[0.07] bg-white dark:bg-transparent">
      <table className="w-full text-sm">
        <thead className="bg-slate-50/90 dark:bg-white/[0.025] backdrop-blur-sm sticky top-0">
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
                      <div className="h-4 shimmer-bg rounded-lg w-3/4" />
                    </td>
                  ))}
                </tr>
              ))
            : data.length === 0
              ? (
                <tr>
                  <td colSpan={columns.length} className="py-12 text-center text-muted text-sm">
                    {empty ?? 'Nenhum registro encontrado.'}
                  </td>
                </tr>
              )
              : data.map((row, i) => (
                  <tr key={row.id ?? i} className="hover:bg-primary-subtle/45 dark:hover:bg-primary/[0.045] transition-colors">
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