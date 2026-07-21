import { useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { ToastContainer } from '../ui/Toast';
import { useMonthStore } from '../../store/monthStore';
import { useUIStore } from '../../store/uiStore';
import { useTutorialStore } from '../../store/tutorialStore';
import { TutorialRunner } from '../tutorial/TutorialRunner';

const ROUTE_TITLES = {
  '/dashboard': 'Visão geral',
  '/incomes': 'Receitas',
  '/expenses': 'Despesas',
  '/cards': 'Cartões de crédito',
  '/savings': 'Reserva financeira',
  '/goals': 'Metas financeiras',
  '/budgets': 'Orçamento',
  '/simulator/purchase': 'Simulador de compras',
  '/simulator/what-if': 'Simulador E Se?',
  '/history': 'Histórico financeiro',
  '/trends': 'Tendências',
  '/insights': 'Alertas e recomendações',
  '/reports': 'Relatórios',
  '/settings': 'Configurações',
};

export function AppLayout() {
  const initialize = useMonthStore((s) => s.initialize);
  const open = useUIStore((s) => s.sidebarOpen);
  const location = useLocation();
  const title = ROUTE_TITLES[location.pathname] ?? 'FinanceHub';
  const hasSeenTutorial = useTutorialStore((s) => s.hasSeenTutorial);
  const startTutorial = useTutorialStore((s) => s.start);
  const shellRef = useRef(null);

  useEffect(() => { initialize(); }, [initialize]);

  useEffect(() => {
    if (hasSeenTutorial()) return;
    const timer = setTimeout(() => startTutorial(), 900);
    return () => clearTimeout(timer);
  }, [hasSeenTutorial, startTutorial]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return undefined;
    let frame;
    const move = (event) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        shell.style.setProperty('--mouse-x', `${event.clientX}px`);
        shell.style.setProperty('--mouse-y', `${event.clientY}px`);
      });
    };
    window.addEventListener('pointermove', move, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
    };
  }, []);

  return (
    <div ref={shellRef} className="app-shell theme-transition">
      <span className="ambient-orb ambient-orb-one" aria-hidden="true" />
      <span className="ambient-orb ambient-orb-two" aria-hidden="true" />
      <Sidebar />
      <div className={`min-h-screen transition-[margin] duration-300 ease-smooth ${open ? 'lg:ml-[272px]' : 'lg:ml-[84px]'}`}>
        <Topbar title={title} />
        <main className="page-content px-4 py-5 sm:px-6 sm:py-7 lg:px-8 lg:py-8">
          <div key={location.pathname} className="route-stage">
            <Outlet />
          </div>
        </main>
      </div>
      <ToastContainer />
      <TutorialRunner />
    </div>
  );
}
