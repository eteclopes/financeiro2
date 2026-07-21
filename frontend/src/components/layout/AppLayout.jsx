import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { ToastContainer } from '../ui/Toast';
import { useMonthStore } from '../../store/monthStore';
import { useUIStore } from '../../store/uiStore';
import { useTutorialStore } from '../../store/tutorialStore';
import { TutorialRunner } from '../tutorial/TutorialRunner';

const ROUTE_TITLES = {
  '/dashboard':          'Dashboard',
  '/incomes':            'Receitas',
  '/expenses':           'Despesas',
  '/subscriptions':      'Assinaturas',
  '/cards':              'Cartões de Crédito',
  '/savings':            'Reserva Financeira',
  '/goals':              'Metas Financeiras',
  '/simulator/purchase': 'Simulador de Compras',
  '/simulator/what-if':  'Simulador E Se?',
  '/history':            'Histórico Financeiro',
  '/reports':            'Relatórios',
  '/settings':           'Configurações',
};

export function AppLayout() {
  const initialize = useMonthStore((s) => s.initialize);
  const open       = useUIStore((s) => s.sidebarOpen);
  const location   = useLocation();
  const title      = ROUTE_TITLES[location.pathname] ?? 'FinançasPro';
  const hasSeenTutorial = useTutorialStore((s) => s.hasSeenTutorial);
  const startTutorial   = useTutorialStore((s) => s.start);

  useEffect(() => { initialize(); }, [initialize]);

  // Só dispara sozinho no PRIMEIRO acesso (hasSeenTutorial checa uma flag
  // por usuário salva no navegador — ver tutorialStore.js). Um pequeno
  // atraso dá tempo do dashboard terminar de carregar os dados antes do
  // tour tentar destacar elementos que ainda não renderizaram.
  useEffect(() => {
    if (hasSeenTutorial()) return;
    const timer = setTimeout(() => startTutorial(), 900);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-bg dark:bg-canvas-dark theme-transition">
      <Sidebar />
      <div className={`transition-all duration-300 ease-smooth ${open ? 'lg:ml-64' : 'lg:ml-[68px]'}`}>
        <Topbar title={title} />
        <main className="p-4 sm:p-6 animate-fade-in">
          <Outlet />
        </main>
      </div>
      <ToastContainer />
      <TutorialRunner />
    </div>
  );
}