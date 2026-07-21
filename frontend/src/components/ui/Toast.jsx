import { useUIStore } from '../../store/uiStore';

const STYLES = {
  success: 'bg-success text-white',
  error:   'bg-danger text-white',
  warning: 'bg-warning text-white',
  info:    'bg-info text-white',
};
const ICONS = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };

export function ToastContainer() {
  const toasts     = useUIStore((s) => s.toasts);
  const removeToast = useUIStore((s) => s.removeToast);

  return (
    <div aria-live="polite" aria-atomic="false"
      className="fixed bottom-[calc(5.8rem+env(safe-area-inset-bottom))] right-3 sm:right-6 lg:bottom-6 z-[130] flex flex-col gap-2 max-w-sm w-[calc(100%-1.5rem)] pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} role="status"
          className={`flex items-start gap-3 rounded-2xl px-4 py-3.5 shadow-modal border border-white/20 backdrop-blur-xl pointer-events-auto animate-slide-up ${STYLES[t.type] ?? STYLES.info}`}>
          <span className="text-base leading-none mt-0.5 shrink-0">{ICONS[t.type]}</span>
          <p className="flex-1 text-sm font-medium">{t.message}</p>
          <button onClick={() => removeToast(t.id)} aria-label="Fechar notificação" className="opacity-70 hover:opacity-100 text-xl leading-none ml-1 shrink-0">×</button>
        </div>
      ))}
    </div>
  );
}
