import { NavLink } from 'react-router-dom';
import { useUIStore } from '../../store/uiStore';
import { IconDashboard, IconIncome, IconExpense, IconCard, IconMenu } from '../icons';

const ITEMS = [
  { to: '/dashboard', label: 'Visão', Icon: IconDashboard },
  { to: '/incomes', label: 'Receitas', Icon: IconIncome },
  { to: '/expenses', label: 'Despesas', Icon: IconExpense },
  { to: '/cards', label: 'Cartões', Icon: IconCard },
];

export function MobileNav() {
  const openSidebar = useUIStore((state) => state.setSidebar);

  return (
    <nav className="mobile-nav lg:hidden" aria-label="Navegação rápida">
      <div className="mobile-nav-inner">
        {ITEMS.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => `mobile-nav-item ${isActive ? 'mobile-nav-item-active' : ''}`}>
            <Icon size={19} strokeWidth={2} />
            <span>{label}</span>
          </NavLink>
        ))}
        <button type="button" onClick={() => openSidebar(true)} className="mobile-nav-item" aria-label="Abrir todos os módulos">
          <IconMenu size={19} strokeWidth={2} />
          <span>Mais</span>
        </button>
      </div>
    </nav>
  );
}
