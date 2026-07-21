import { useEffect, Component } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import { useThemeStore } from './store/themeStore';
import { ToastContainer } from './components/ui/Toast';
import { AppLayout } from './components/layout/AppLayout';
import { IconSun, IconMoon, IconTrend, IconWallet, IconCard } from './components/icons';

import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import DashboardPage from './pages/DashboardPage';
import IncomesPage from './pages/IncomesPage';
import ExpensesPage from './pages/ExpensesPage';
import CardsPage from './pages/CardsPage';
import SavingsPage from './pages/SavingsPage';
import GoalsPage from './pages/GoalsPage';
import PurchaseSimulatorPage from './pages/PurchaseSimulatorPage';
import WhatIfSimulatorPage from './pages/WhatIfSimulatorPage';
import HistoryPage from './pages/HistoryPage';
import TrendsPage from './pages/TrendsPage';
import BudgetsPage from './pages/BudgetsPage';
import InsightsPage from './pages/InsightsPage';
import ReportsPage from './pages/ReportsPage';
import SettingsPage from './pages/SettingsPage';

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="app-shell flex min-h-screen items-center justify-center p-6">
          <div className="premium-card w-full max-w-md p-8 text-center">
            <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-danger-subtle text-2xl text-danger dark:bg-danger/10 dark:text-danger-light">!</div>
            <h2 className="mb-2 text-xl font-bold tracking-tight text-slate-950 dark:text-white">Algo não saiu como esperado</h2>
            <p className="mb-6 text-sm leading-relaxed text-slate-500 dark:text-zinc-400">{this.state.error?.message ?? 'Erro inesperado na aplicação.'}</p>
            <button
              onClick={() => { this.setState({ error: null }); window.location.reload(); }}
              className="btn-base rounded-xl bg-primary px-5 py-2.5 text-sm text-white hover:bg-primary-dark"
            >
              Recarregar aplicação
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function ProtectedRoute({ children }) {
  const status = useAuthStore((s) => s.status);
  if (status === 'idle' || status === 'loading') {
    return (
      <div className="app-shell flex min-h-screen flex-col items-center justify-center gap-5">
        <div className="relative grid h-16 w-16 place-items-center rounded-2xl bg-primary text-white shadow-glow animate-pulse-soft">
          <span className="text-lg font-black tracking-[-0.08em]">FH</span>
          <span className="absolute -inset-3 -z-10 rounded-3xl border border-primary/20 animate-ping" />
        </div>
        <div className="text-center">
          <p className="text-sm font-bold text-slate-700 dark:text-zinc-200">Preparando seu painel</p>
          <p className="mt-1 text-xs text-slate-400 dark:text-zinc-500">Carregando dados financeiros...</p>
        </div>
      </div>
    );
  }
  if (status === 'unauthenticated') return <Navigate to="/login" replace />;
  return children;
}

function AuthShell({ children }) {
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#F8FAFC] dark:bg-[#0B0B0F]">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-28 -top-24 h-[420px] w-[420px] rounded-full bg-primary/10 blur-[90px] dark:bg-primary/20" />
        <div className="absolute -bottom-40 right-[-8rem] h-[520px] w-[520px] rounded-full bg-info/8 blur-[110px] dark:bg-primary-light/10" />
        <div className="absolute inset-0 opacity-[0.28] dark:opacity-[0.1]" style={{ backgroundImage: 'radial-gradient(rgb(100 116 139 / 0.28) 0.7px, transparent 0.7px)', backgroundSize: '22px 22px' }} />
      </div>

      <button
        onClick={toggleTheme}
        aria-label="Alternar tema"
        className="absolute right-5 top-5 z-30 grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white/80 text-slate-500 shadow-sm backdrop-blur-xl transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:text-primary dark:border-white/[0.08] dark:bg-white/[0.055] dark:text-zinc-400 dark:hover:text-primary-hover"
      >
        {theme === 'dark' ? <IconMoon size={17} /> : <IconSun size={17} />}
      </button>

      <div className="relative z-10 grid min-h-screen lg:grid-cols-[1.08fr_0.92fr]">
        <section className="relative hidden overflow-hidden border-r border-slate-200/70 px-10 py-10 dark:border-white/[0.06] lg:flex lg:flex-col xl:px-16 xl:py-14">
          <div className="flex items-center gap-3">
            <div className="relative grid h-11 w-11 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-primary via-primary-light to-info text-white shadow-glow">
              <span className="relative z-10 text-base font-black tracking-[-0.08em]">FH</span>
              <span className="absolute -right-1 -top-2 h-7 w-7 rounded-full bg-white/25 blur-md" />
            </div>
            <div>
              <p className="text-lg font-extrabold tracking-[-0.03em] text-slate-950 dark:text-white">FinanceHub</p>
              <p className="text-[11px] font-medium text-slate-400 dark:text-zinc-500">Finanças claras. Decisões melhores.</p>
            </div>
          </div>

          <div className="my-auto max-w-xl py-14">
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary-subtle px-3 py-1.5 text-xs font-bold text-primary-dark dark:border-primary/20 dark:bg-primary/10 dark:text-primary-hover">
              <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_10px_#A855F7]" />
              Controle financeiro inteligente
            </span>
            <h1 className="mt-6 max-w-lg text-4xl font-extrabold leading-[1.08] tracking-[-0.045em] text-slate-950 dark:text-white xl:text-5xl">
              Seu dinheiro em uma visão <span className="bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent">simples e poderosa.</span>
            </h1>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-slate-500 dark:text-zinc-400">
              Organize receitas, despesas, cartões, metas e reservas em um painel elegante, rápido e feito para o seu dia a dia.
            </p>

            <div className="mt-9 grid max-w-lg grid-cols-3 gap-3">
              {[
                { Icon: IconTrend, label: 'Visão mensal', value: '360°', tone: 'text-primary dark:text-primary-hover bg-primary-subtle dark:bg-primary/10' },
                { Icon: IconWallet, label: 'Saldo real', value: 'Ao vivo', tone: 'text-success dark:text-success-light bg-success-subtle dark:bg-success/10' },
                { Icon: IconCard, label: 'Cartões', value: 'Integrados', tone: 'text-info dark:text-info-light bg-info-subtle dark:bg-info/10' },
              ].map(({ Icon, label, value, tone }) => (
                <div key={label} className="rounded-2xl border border-slate-200/80 bg-white/75 p-4 shadow-card backdrop-blur-xl dark:border-white/[0.07] dark:bg-white/[0.035]">
                  <div className={`mb-4 grid h-9 w-9 place-items-center rounded-xl ${tone}`}><Icon size={17} /></div>
                  <p className="text-sm font-bold text-slate-800 dark:text-zinc-100">{value}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400 dark:text-zinc-500">{label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="relative max-w-lg rounded-3xl border border-slate-200/80 bg-white/80 p-5 shadow-premium backdrop-blur-xl animate-float dark:border-white/[0.07] dark:bg-white/[0.04]">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-zinc-500">Saldo disponível</p>
                <p className="mt-2 font-mono text-2xl font-bold text-slate-950 dark:text-white">R$ 8.420,50</p>
              </div>
              <span className="rounded-full bg-success-subtle px-2.5 py-1 text-[11px] font-bold text-success-dark dark:bg-success/10 dark:text-success-light">↗ 12,4%</span>
            </div>
            <div className="mt-5 flex h-16 items-end gap-1.5">
              {[32, 48, 37, 58, 44, 69, 54, 78, 67, 88, 73, 94].map((height, i) => (
                <div key={i} className="flex-1 rounded-t-md bg-gradient-to-t from-primary to-primary-light opacity-80" style={{ height: `${height}%` }} />
              ))}
            </div>
          </div>
        </section>

        <section className="flex min-h-screen items-center justify-center px-4 py-16 sm:px-8 lg:px-12">
          <div className="w-full max-w-[440px] animate-slide-up">
            <div className="mb-7 flex items-center gap-3 lg:hidden">
              <div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-primary to-primary-light text-sm font-black tracking-[-0.08em] text-white shadow-glow">FH</div>
              <div>
                <p className="font-extrabold tracking-tight text-slate-950 dark:text-white">FinanceHub</p>
                <p className="text-[11px] text-slate-400 dark:text-zinc-500">Sua vida financeira</p>
              </div>
            </div>
            {children}
            <p className="mt-6 text-center text-[11px] leading-relaxed text-slate-400 dark:text-zinc-600">
              Seus dados são protegidos e utilizados apenas para organizar sua experiência financeira.
            </p>
          </div>
        </section>
      </div>
      <ToastContainer />
    </div>
  );
}

export default function App() {
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const forceSignOut = useAuthStore((s) => s.forceSignOut);

  useEffect(() => { bootstrap(); }, [bootstrap]);
  useEffect(() => {
    const h = () => forceSignOut();
    window.addEventListener('auth:session-expired', h);
    return () => window.removeEventListener('auth:session-expired', h);
  }, [forceSignOut]);

  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/login" element={<AuthShell><LoginPage /></AuthShell>} />
        <Route path="/register" element={<AuthShell><RegisterPage /></AuthShell>} />
        <Route path="/forgot-password" element={<AuthShell><ForgotPasswordPage /></AuthShell>} />
        <Route path="/reset-password" element={<AuthShell><ResetPasswordPage /></AuthShell>} />

        <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
          <Route path="/dashboard" element={<ErrorBoundary><DashboardPage /></ErrorBoundary>} />
          <Route path="/incomes" element={<ErrorBoundary><IncomesPage /></ErrorBoundary>} />
          <Route path="/expenses" element={<ErrorBoundary><ExpensesPage /></ErrorBoundary>} />
          <Route path="/cards" element={<ErrorBoundary><CardsPage /></ErrorBoundary>} />
          <Route path="/savings" element={<ErrorBoundary><SavingsPage /></ErrorBoundary>} />
          <Route path="/goals" element={<ErrorBoundary><GoalsPage /></ErrorBoundary>} />
          <Route path="/simulator/purchase" element={<ErrorBoundary><PurchaseSimulatorPage /></ErrorBoundary>} />
          <Route path="/simulator/what-if" element={<ErrorBoundary><WhatIfSimulatorPage /></ErrorBoundary>} />
          <Route path="/history" element={<ErrorBoundary><HistoryPage /></ErrorBoundary>} />
          <Route path="/trends" element={<ErrorBoundary><TrendsPage /></ErrorBoundary>} />
          <Route path="/budgets" element={<ErrorBoundary><BudgetsPage /></ErrorBoundary>} />
          <Route path="/insights" element={<ErrorBoundary><InsightsPage /></ErrorBoundary>} />
          <Route path="/reports" element={<ErrorBoundary><ReportsPage /></ErrorBoundary>} />
          <Route path="/settings" element={<ErrorBoundary><SettingsPage /></ErrorBoundary>} />
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}
