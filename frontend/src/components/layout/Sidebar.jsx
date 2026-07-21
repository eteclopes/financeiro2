import { NavLink, useNavigate } from 'react-router-dom';
import { useUIStore } from '../../store/uiStore';
import { useAuthStore } from '../../store/authStore';
import {
  IconDashboard, IconIncome, IconExpense, IconCard, IconWallet, IconGoal,
  IconSimulator, IconHistory, IconReport, IconSettings, IconLogout,
  IconTrend, IconBudget, IconBell,
} from '../icons';

const NAV = [
  { to: '/dashboard',          Icon: IconDashboard, label: 'Dashboard',           group: 'main' },
  { to: '/incomes',            Icon: IconIncome,    label: 'Receitas',            group: 'main' },
  { to: '/expenses',           Icon: IconExpense,   label: 'Despesas',            group: 'main' },
  { to: '/cards',               Icon: IconCard,      label: 'Cartões',             group: 'main' },
  { to: '/savings',            Icon: IconWallet,    label: 'Reserva Financeira',  group: 'main' },
  { to: '/goals',              Icon: IconGoal,      label: 'Metas',               group: 'main' },
  { to: '/subscriptions',      Icon: IconCard,      label: 'Assinaturas',         group: 'main' },
  { to: '/budgets',            Icon: IconBudget,    label: 'Orçamento',           group: 'main' },
  { to: '/simulator/purchase', Icon: IconSimulator, label: 'Simulador de Compras',group: 'tools' },
  { to: '/simulator/what-if',  Icon: IconSimulator, label: 'Simulador E Se?',     group: 'tools' },
  { to: '/history',            Icon: IconHistory,   label: 'Histórico',           group: 'tools' },
  { to: '/trends',             Icon: IconTrend,     label: 'Tendências',          group: 'tools' },
  { to: '/insights',           Icon: IconBell,      label: 'Alertas e Dicas',     group: 'tools' },
  { to: '/reports',            Icon: IconReport,    label: 'Relatórios',          group: 'tools' },
  { to: '/settings',           Icon: IconSettings,  label: 'Configurações',       group: 'system' },
];

const GROUPS = [
  { key: 'main',   label: 'Financeiro' },
  { key: 'tools',  label: 'Ferramentas' },
  { key: 'system', label: 'Sistema' },
];

export function Sidebar() {
  const open   = useUIStore((s) => s.sidebarOpen);
  const setSidebar = useUIStore((s) => s.setSidebar);
  const logout = useAuthStore((s) => s.logout);
  const user   = useAuthStore((s) => s.user);
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-20 bg-slate-900/40 backdrop-blur-sm lg:hidden animate-fade-in"
          onClick={() => setSidebar(false)} />
      )}
      <aside className={`fixed inset-y-0 left-0 z-30 flex flex-col bg-sidebar dark:bg-canvas-dark dark:border-r dark:border-white/[0.06] transition-all duration-300 ease-smooth
        ${open ? 'w-64' : 'w-0 lg:w-[68px]'} overflow-hidden`}>
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 h-16 border-b border-white/5 shrink-0">
          <div className="h-9 w-9 bg-gradient-to-br from-primary to-info rounded-xl flex items-center justify-center text-white font-bold text-base shrink-0 shadow-glow">
            F
          </div>
          <div className={`transition-all duration-200 ${open ? 'opacity-100 delay-75' : 'opacity-0 lg:hidden'}`}>
            <p className="text-white font-semibold text-base leading-tight tracking-tight">FinançasPro</p>
            <p className="text-slate-500 text-xs">Gestão financeira</p>
          </div>
        </div>

        {/* Nav */}
        <nav aria-label="Navegação principal" className="flex-1 px-3 py-4 overflow-y-auto overflow-x-hidden space-y-5">
          {GROUPS.map((group) => {
            const items = NAV.filter((n) => n.group === group.key);
            return (
              <div key={group.key}>
                {open && (
                  <p className="px-3 mb-2 text-[10px] font-bold text-slate-600 uppercase tracking-widest">
                    {group.label}
                  </p>
                )}
                <div className="space-y-0.5">
                  {items.map(({ to, Icon, label }) => (
                    <NavLink key={to} to={to} onClick={() => window.innerWidth < 1024 && setSidebar(false)}
                      className={({ isActive }) =>
                        `nav-item relative ${isActive ? 'nav-item-active' : 'nav-item-inactive'}`
                      }>
                      {({ isActive }) => (
                        <>
                          {isActive && (
                            <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-primary-light" />
                          )}
                          <Icon size={18} className="shrink-0" strokeWidth={isActive ? 2 : 1.75} />
                          <span className={`truncate transition-all duration-200 ${open ? 'opacity-100' : 'opacity-0 w-0 lg:hidden'}`}>
                            {label}
                          </span>
                        </>
                      )}
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        {/* User */}
        <div className="border-t border-white/5 p-3 shrink-0">
          <div className="flex items-center gap-3 px-1">
            <div className="h-8 w-8 bg-primary/20 rounded-xl flex items-center justify-center text-primary font-semibold text-sm shrink-0">
              {user?.name?.[0]?.toUpperCase() ?? 'U'}
            </div>
            <div className={`flex-1 min-w-0 transition-all duration-200 ${open ? 'opacity-100' : 'opacity-0 w-0 lg:hidden'}`}>
              <p className="text-white text-xs font-medium truncate">{user?.name}</p>
              <button onClick={handleLogout} className="text-slate-500 hover:text-slate-300 text-xs transition-colors flex items-center gap-1">
                <IconLogout size={11} />
                Sair da conta
              </button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}