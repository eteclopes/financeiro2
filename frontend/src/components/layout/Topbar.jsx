import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUIStore } from '../../store/uiStore';
import { useMonthStore } from '../../store/monthStore';
import { useThemeStore } from '../../store/themeStore';
import { useAuthStore } from '../../store/authStore';
import { formatMonthLabel } from '../../lib/format';
import { alertsApi } from '../../lib/services';
import { Dropdown } from '../ui/Dropdown';
import { IconMenu, IconBell, IconSun, IconMoon, IconChevronL, IconChevronR } from '../icons';

const SEVERITY_DOT = { critical: 'bg-danger', warning: 'bg-warning', info: 'bg-info' };

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

export function Topbar({ title }) {
  const toggle = useUIStore((s) => s.toggleSidebar);
  const months = useMonthStore((s) => s.months);
  const selectedId = useMonthStore((s) => s.selectedMonthId);
  const selectMonth = useMonthStore((s) => s.selectMonth);
  const getSelected = useMonthStore((s) => s.getSelectedMonth);
  const goToAdjacent = useMonthStore((s) => s.goToAdjacent);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();

  const month = getSelected();
  const idx = months.findIndex((m) => String(m.id) === String(selectedId));
  const [alerts, setAlerts] = useState([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef(null);

  const loadAlerts = useCallback(async () => {
    if (!selectedId) return;
    try {
      const { data } = await alertsApi.list(selectedId);
      setAlerts(data.alerts ?? []);
    } catch {
      // A central de alertas já apresenta falhas de carregamento ao usuário.
    }
  }, [selectedId]);

  useEffect(() => {
    loadAlerts();
    const interval = setInterval(loadAlerts, 60_000);
    return () => clearInterval(interval);
  }, [loadAlerts]);

  const activeAlerts = alerts.filter((a) => !a.resolvedAt);

  useEffect(() => {
    function handleOutside(e) {
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false);
    }
    function handleKey(e) {
      if (e.key === 'Escape') setNotifOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  return (
    <header className="app-topbar glass sticky top-0 z-20 flex min-h-[76px] items-center gap-3 border-b border-slate-200/80 px-4 dark:border-white/[0.06] sm:px-6 lg:px-8">
      <button
        onClick={toggle}
        aria-label="Abrir ou recolher menu"
        className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:text-primary dark:border-white/[0.07] dark:bg-white/[0.035] dark:text-zinc-400 dark:hover:border-primary/30 dark:hover:text-primary-hover"
      >
        <IconMenu size={19} />
      </button>

      <div className="min-w-0 flex-1 sm:flex-none">
        <h1 className="truncate text-base font-bold tracking-tight text-slate-950 dark:text-white sm:text-lg">{title}</h1>
        {month ? (
          <Dropdown variant="ghost" value={selectedId ?? ''} onChange={(e) => selectMonth(e.target.value)} className="mt-0.5 max-w-[132px] sm:hidden">
            {months.map((m) => <option key={m.id} value={m.id}>{formatMonthLabel(m)}</option>)}
          </Dropdown>
        ) : null}
        <p className="hidden text-xs text-slate-400 dark:text-zinc-500 sm:block">{greeting()}, {user?.name?.split(' ')?.[0] ?? 'bem-vindo'}.</p>
      </div>

      <div className="hidden flex-1 sm:block" />

      {month && (
        <div data-tutorial="month-selector" className="hidden items-center gap-1 rounded-xl border border-slate-200 bg-white/85 p-1 shadow-sm dark:border-white/[0.07] dark:bg-white/[0.035] sm:flex">
          <button
            onClick={() => goToAdjacent(-1)}
            disabled={idx <= 0}
            aria-label="Mês anterior"
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition-all hover:bg-primary-subtle hover:text-primary-dark disabled:opacity-25 dark:text-zinc-500 dark:hover:bg-primary/10 dark:hover:text-primary-hover"
          >
            <IconChevronL size={15} />
          </button>

          <Dropdown variant="ghost" value={selectedId ?? ''} onChange={(e) => selectMonth(e.target.value)} className="min-w-[138px] max-w-[170px]">
            {months.map((m) => <option key={m.id} value={m.id}>{formatMonthLabel(m)}</option>)}
          </Dropdown>

          <button
            onClick={() => goToAdjacent(1)}
            disabled={idx >= months.length - 1}
            aria-label="Próximo mês"
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition-all hover:bg-primary-subtle hover:text-primary-dark disabled:opacity-25 dark:text-zinc-500 dark:hover:bg-primary/10 dark:hover:text-primary-hover"
          >
            <IconChevronR size={15} />
          </button>

          {month.status === 'closed' && (
            <span className="mr-1 rounded-full bg-slate-100 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:bg-white/[0.07] dark:text-zinc-500">encerrado</span>
          )}
        </div>
      )}

      <div ref={notifRef} className="relative">
        <button
          aria-label="Notificações"
          onClick={() => setNotifOpen((o) => !o)}
          className="relative grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:text-primary dark:border-white/[0.07] dark:bg-white/[0.035] dark:text-zinc-400 dark:hover:border-primary/30 dark:hover:text-primary-hover"
        >
          <IconBell size={18} />
          {activeAlerts.length > 0 && (
            <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-danger ring-2 ring-white dark:ring-[#15151D]">
              <span className="absolute inset-0 animate-ping rounded-full bg-danger/70" />
            </span>
          )}
        </button>

        {notifOpen && (
          <div className="notification-panel z-[100] overflow-y-auto rounded-2xl border border-slate-200 bg-white/95 py-2 shadow-modal backdrop-blur-xl animate-scale-in origin-top-right dark:border-white/[0.08] dark:bg-[#1B1B26]/95">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-white/[0.07]">
              <div>
                <p className="text-sm font-bold text-slate-950 dark:text-white">Notificações</p>
                <p className="mt-0.5 text-[11px] text-slate-400 dark:text-zinc-500">{activeAlerts.length} alerta(s) ativo(s)</p>
              </div>
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-primary-subtle text-primary dark:bg-primary/10 dark:text-primary-hover">
                <IconBell size={15} />
              </span>
            </div>

            {activeAlerts.length === 0 ? (
              <div className="px-5 py-9 text-center">
                <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-2xl bg-success-subtle text-success dark:bg-success/10 dark:text-success-light">✓</div>
                <p className="text-sm font-bold text-slate-800 dark:text-zinc-200">Tudo em ordem</p>
                <p className="mt-1 text-xs text-slate-400 dark:text-zinc-500">Nenhum alerta ativo neste mês.</p>
              </div>
            ) : (
              activeAlerts.slice(0, 6).map((a) => (
                <div key={a.id} className="flex items-start gap-3 border-b border-slate-100 px-4 py-3.5 last:border-0 hover:bg-slate-50 dark:border-white/[0.055] dark:hover:bg-white/[0.025]">
                  <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${SEVERITY_DOT[a.severity] ?? 'bg-info'}`} />
                  <p className="text-sm leading-relaxed text-slate-600 dark:text-zinc-300">{a.message}</p>
                </div>
              ))
            )}

            <button
              onClick={() => { setNotifOpen(false); navigate('/insights'); }}
              className="mx-2 mt-1 w-[calc(100%-1rem)] rounded-xl py-2.5 text-center text-sm font-bold text-primary-dark transition-colors hover:bg-primary-subtle dark:text-primary-hover dark:hover:bg-primary/10"
            >
              Abrir central de alertas
            </button>
          </div>
        )}
      </div>


      <button
        onClick={toggleTheme}
        aria-label="Alternar tema"
        className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:text-primary dark:border-white/[0.07] dark:bg-white/[0.035] dark:text-zinc-400 dark:hover:border-primary/30 dark:hover:text-primary-hover"
      >
        <span className="transition-transform duration-500" style={{ transform: theme === 'dark' ? 'rotate(180deg)' : 'rotate(0deg)' }}>
          {theme === 'dark' ? <IconMoon size={17} /> : <IconSun size={17} />}
        </span>
      </button>

      <div className="hidden items-center gap-2.5 rounded-xl border border-slate-200 bg-white p-1.5 pr-3 shadow-sm dark:border-white/[0.07] dark:bg-white/[0.035] lg:flex">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-primary to-primary-light text-xs font-bold text-white">
          {user?.name?.[0]?.toUpperCase() ?? 'U'}
        </div>
        <div className="max-w-[130px]">
          <p className="truncate text-xs font-bold text-slate-700 dark:text-zinc-200">{user?.name}</p>
          <p className="truncate text-[10px] text-slate-400 dark:text-zinc-500">Conta pessoal</p>
        </div>
      </div>
    </header>
  );
}
