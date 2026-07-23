import { createPortal } from 'react-dom';
import { useUIStore } from '../../store/uiStore';

const STYLES = {
  success: 'bg-success text-white',
  error:   'bg-danger text-white',
  warning: 'bg-warning text-white',
  info:    'bg-info text-white',
};
const ICONS = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };

export function ToastContainer() {
  const toasts      = useUIStore((s) => s.toasts);
  const removeToast = useUIStore((s) => s.removeToast);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      aria-live="polite"
      aria-atomic="false"
      className="toast-layer pointer-events-none flex w-[calc(100%-1.5rem)] max-w-sm flex-col gap-2"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.type === 'error' ? 'alert' : 'status'}
          className={`pointer-events-auto flex items-start gap-3 rounded-2xl border border-white/20 px-4 py-3.5 shadow-modal backdrop-blur-xl animate-slide-up ${STYLES[t.type] ?? STYLES.info}`}
        >
          <span className="mt-0.5 shrink-0 text-base leading-none">{ICONS[t.type]}</span>
          <p className="flex-1 text-sm font-medium">{t.message}</p>
          <button
            type="button"
            onClick={() => removeToast(t.id)}
            aria-label="Fechar notificação"
            className="ml-1 shrink-0 text-xl leading-none opacity-70 hover:opacity-100"
          >
            ×
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
