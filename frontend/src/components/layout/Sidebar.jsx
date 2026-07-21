import { useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useUIStore } from '../../store/uiStore';
import { useAuthStore } from '../../store/authStore';
import {
  IconDashboard, IconIncome, IconExpense, IconCard, IconWallet, IconGoal,
  IconSimulator, IconHistory, IconReport, IconSettings, IconLogout,
  IconTrend, IconBudget, IconBell,
} from '../icons';

const NAV = [
  { to: '/dashboard', Icon: IconDashboard, label: 'Visão geral', group: 'main', tutorial: 'nav-dashboard' },
  { to: '/incomes', Icon: IconIncome, label: 'Receitas', group: 'main', tutorial: 'nav-incomes' },
  { to: '/expenses', Icon: IconExpense, label: 'Despesas', group: 'main', tutorial: 'nav-expenses' },
  { to: '/cards', Icon: IconCard, label: 'Cartões', group: 'main', tutorial: 'nav-cards' },
  { to: '/savings', Icon: IconWallet, label: 'Reserva', group: 'main', tutorial: 'nav-savings' },
  { to: '/goals', Icon: IconGoal, label: 'Metas', group: 'main', tutorial: 'nav-goals' },
  { to: '/budgets', Icon: IconBudget, label: 'Orçamento', group: 'main', tutorial: 'nav-budgets' },
  { to: '/simulator/purchase', Icon: IconSimulator, label: 'Simular compra', group: 'tools', tutorial: 'nav-purchase-simulator' },
  { to: '/simulator/what-if', Icon: IconSimulator, label: 'Simulador E Se?', group: 'tools', tutorial: 'nav-what-if' },
  { to: '/history', Icon: IconHistory, label: 'Histórico', group: 'tools', tutorial: 'nav-history' },
  { to: '/trends', Icon: IconTrend, label: 'Tendências', group: 'tools', tutorial: 'nav-trends' },
  { to: '/insights', Icon: IconBell, label: 'Alertas e dicas', group: 'tools', tutorial: 'nav-insights' },
  { to: '/reports', Icon: IconReport, label: 'Relatórios', group: 'tools', tutorial: 'nav-reports' },
  { to: '/settings', Icon: IconSettings, label: 'Configurações', group: 'system', tutorial: 'nav-settings' },
];

const GROUPS = [
  { key: 'main', label: 'Financeiro' },
  { key: 'tools', label: 'Inteligência' },
  { key: 'system', label: 'Conta' },
];

function BrandMark({ compact = false }) {
  return (
    <div className={`relative grid shrink-0 place-items-center overflow-hidden bg-gradient-to-br from-primary via-primary-light to-info text-white shadow-glow ${compact ? 'h-10 w-10 rounded-[14px]' : 'h-11 w-11 rounded-2xl'}`}>
      <span className="relative z-10 text-lg font-black tracking-[-0.08em]">FH</span>
      <span className="absolute -right-2 -top-3 h-8 w-8 rounded-full bg-white/25 blur-md" />
    </div>
  );
}

export function Sidebar() {
  const open = useUIStore((s) => s.sidebarOpen);
  const setSidebar = useUIStore((s) => s.setSidebar);
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open || window.innerWidth >= 1024) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setSidebar(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open, setSidebar]);

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-slate-950/45 backdrop-blur-sm lg:hidden animate-fade-in"
          onClick={() => setSidebar(false)}
        />
      )}

      <aside aria-hidden={!open && typeof window !== 'undefined' && window.innerWidth < 1024} className={`fixed inset-y-0 left-0 z-40 flex max-w-full flex-col overflow-hidden border-r border-slate-200/80 bg-white/[0.98] shadow-[8px_0_35px_-28px_rgb(15_23_42_/_0.35)] backdrop-blur-xl transition-[width,transform] duration-300 ease-smooth dark:border-white/[0.06] dark:bg-[#0F0F15]/[0.98] dark:shadow-[12px_0_45px_-32px_rgb(0_0_0_/_0.9)] ${open ? 'w-[min(86vw,19rem)] lg:w-[272px]' : 'w-0 lg:w-[84px]'}`}>
        <div className="flex h-[76px] shrink-0 items-center gap-3 border-b border-slate-200/80 px-4 pt-[env(safe-area-inset-top)] dark:border-white/[0.06]">
          <BrandMark compact={!open} />
          <div className={`min-w-0 flex-1 transition-all duration-200 ${open ? 'opacity-100' : 'pointer-events-none w-0 flex-none opacity-0'}`}>
            <p className="truncate text-[17px] font-extrabold tracking-[-0.025em] text-slate-950 dark:text-white">FinanceHub</p>
            <p className="truncate text-[11px] font-medium text-slate-400 dark:text-zinc-500">Sua vida financeira</p>
          </div>
          <button
            type="button"
            onClick={() => setSidebar(false)}
            aria-label="Fechar menu"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-xl leading-none text-slate-500 shadow-sm transition-colors hover:border-primary/30 hover:text-primary dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-zinc-400 lg:hidden"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <nav aria-label="Navegação principal" className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-5">
          <div className="space-y-6">
            {GROUPS.map((group) => {
              const items = NAV.filter((n) => n.group === group.key);
              return (
                <div key={group.key}>
                  {open ? (
                    <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-zinc-600">{group.label}</p>
                  ) : (
                    <div className="mx-auto mb-3 h-px w-7 bg-slate-200 dark:bg-white/[0.07]" />
                  )}
                  <div className="space-y-1">
                    {items.map(({ to, Icon, label, tutorial }) => (
                      <NavLink
                        key={to}
                        to={to}
                        data-tutorial={tutorial}
                        title={!open ? label : undefined}
                        onClick={() => window.innerWidth < 1024 && setSidebar(false)}
                        className={({ isActive }) => `nav-item ${isActive ? 'nav-item-active' : 'nav-item-inactive'} ${!open ? 'lg:justify-center lg:px-0' : ''}`}
                      >
                        {({ isActive }) => (
                          <>
                            <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-all duration-200 ${isActive ? 'bg-primary/10 dark:bg-primary/20' : ''}`}>
                              <Icon size={18} strokeWidth={isActive ? 2.15 : 1.8} />
                            </span>
                            <span className={`truncate transition-all duration-200 ${open ? 'opacity-100' : 'w-0 opacity-0'}`}>{label}</span>
                          </>
                        )}
                      </NavLink>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </nav>

        <div className="shrink-0 border-t border-slate-200/80 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-white/[0.06]">
          <div className={`flex items-center gap-3 rounded-2xl bg-slate-50 p-2.5 dark:bg-white/[0.035] ${!open ? 'lg:justify-center' : ''}`}>
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary to-primary-light text-sm font-bold text-white shadow-[0_8px_20px_-12px_rgb(124_58_237_/_0.9)]">
              {user?.name?.[0]?.toUpperCase() ?? 'U'}
            </div>
            <div className={`min-w-0 flex-1 transition-all duration-200 ${open ? 'opacity-100' : 'w-0 flex-none opacity-0'}`}>
              <p className="truncate text-xs font-bold text-slate-800 dark:text-zinc-100">{user?.name}</p>
              <button onClick={handleLogout} className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-slate-400 transition-colors hover:text-danger dark:text-zinc-500 dark:hover:text-danger-light">
                <IconLogout size={11} /> Sair da conta
              </button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
