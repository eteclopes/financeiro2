import { create } from 'zustand';

let toastId = 0;

function desktopViewport() {
  return typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;
}

export const useUIStore = create((set, get) => ({
  toasts: [],
  // No celular o menu sempre começa fechado. No desktop, inicia expandido.
  sidebarOpen: desktopViewport(),

  addToast(toast) {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, ...toast }] }));
    const duration = toast.duration ?? 4000;
    if (duration > 0) setTimeout(() => get().removeToast(id), duration);
    return id;
  },
  removeToast(id) { set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })); },
  success(message) { return get().addToast({ type: 'success', message }); },
  error(message)   { return get().addToast({ type: 'error', message, duration: 6000 }); },
  info(message)    { return get().addToast({ type: 'info', message }); },
  warning(message) { return get().addToast({ type: 'warning', message }); },
  toggleSidebar()  { set((s) => ({ sidebarOpen: !s.sidebarOpen })); },
  setSidebar(open) { set({ sidebarOpen: Boolean(open) }); },
  syncSidebarForViewport() { set({ sidebarOpen: desktopViewport() }); },
}));
