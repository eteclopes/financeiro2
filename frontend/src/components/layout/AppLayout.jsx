import { lazy, Suspense, useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { MobileNav } from './MobileNav';
import { ToastContainer } from '../ui/Toast';
import { useMonthStore } from '../../store/monthStore';
import { useUIStore } from '../../store/uiStore';
import { useTutorialStore } from '../../store/tutorialStore';
import { waitForTutorialPage } from '../../lib/tutorialDom';


const TutorialRunner = lazy(() => import('../tutorial/TutorialRunner').then((module) => ({
  default: module.TutorialRunner,
})));

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
  const monthStatus = useMonthStore((s) => s.status);
  const open = useUIStore((s) => s.sidebarOpen);
  const setSidebar = useUIStore((s) => s.setSidebar);
  const syncSidebarForViewport = useUIStore((s) => s.syncSidebarForViewport);
  const location = useLocation();
  const title = ROUTE_TITLES[location.pathname] ?? 'FinanceHub';
  const tutorialRequested = useTutorialStore((s) => s.requested);
  const tutorialRunning = useTutorialStore((s) => s.running);
  const startTutorial = useTutorialStore((s) => s.start);
  const cancelTutorial = useTutorialStore((s) => s.cancel);
  const shellRef = useRef(null);
  const tutorialLaunchAttemptedRef = useRef(false);

  useEffect(() => { initialize(); }, [initialize]);

  useEffect(() => {
    if (tutorialRequested) tutorialLaunchAttemptedRef.current = false;
  }, [tutorialRequested]);

  // Mantém o drawer fechado no celular, inclusive logo depois do login.
  // Ao cruzar o breakpoint, sincroniza o comportamento esperado do desktop.
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const handleViewportChange = () => syncSidebarForViewport();
    handleViewportChange();
    media.addEventListener?.('change', handleViewportChange);
    return () => media.removeEventListener?.('change', handleViewportChange);
  }, [syncSidebarForViewport]);

  useEffect(() => {
    if (window.innerWidth < 1024) {
      setSidebar(false);
      document.activeElement?.blur?.();
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [location.pathname, setSidebar]);

  // O tutorial deixou de iniciar automaticamente após login. Ele só começa
  // quando o usuário solicita em Configurações, evitando bloquear a primeira
  // carga do dashboard, abrir overlays ou disputar foco com formulários.
  useEffect(() => {
    if (!tutorialRequested || monthStatus !== 'ready' || location.pathname !== '/dashboard') return undefined;
    if (tutorialLaunchAttemptedRef.current) return undefined;

    tutorialLaunchAttemptedRef.current = true;
    const controller = new AbortController();

    (async () => {
      try {
        const ready = await waitForTutorialPage('[data-tutorial-page-ready="dashboard"]', {
          signal: controller.signal,
          timeout: 6_000,
        });
        if (!ready || controller.signal.aborted) {
          cancelTutorial();
          return;
        }
        if (!controller.signal.aborted && window.location.pathname === '/dashboard') startTutorial();
      } catch (error) {
        if (error?.name !== 'AbortError') console.warn('[Tutorial] Inicialização ignorada sem afetar o app.', error);
        cancelTutorial();
      }
    })();

    return () => controller.abort();
  }, [monthStatus, tutorialRequested, startTutorial, cancelTutorial, location.pathname]);

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
      <div className={`min-h-[100dvh] transition-[margin] duration-300 ease-smooth ${open ? 'lg:ml-[272px]' : 'lg:ml-[84px]'}`}>
        <Topbar title={title} />
        <main className="page-content px-4 pb-28 pt-5 sm:px-6 sm:pb-28 sm:pt-7 lg:px-8 lg:py-8">
          <div key={location.pathname} className="route-stage">
            <Outlet />
          </div>
        </main>
      </div>
      <MobileNav />
      <ToastContainer />
      {tutorialRunning ? (
        <Suspense fallback={null}>
          <TutorialRunner />
        </Suspense>
      ) : null}
    </div>
  );
}
