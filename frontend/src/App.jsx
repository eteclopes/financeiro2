import { useEffect, Component } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import { ToastContainer } from './components/ui/Toast';
import { AppLayout } from './components/layout/AppLayout';

// Pages
import LoginPage           from './pages/LoginPage';
import RegisterPage        from './pages/RegisterPage';
import ForgotPasswordPage  from './pages/ForgotPasswordPage';
import ResetPasswordPage   from './pages/ResetPasswordPage';
import DashboardPage       from './pages/DashboardPage';
import IncomesPage         from './pages/IncomesPage';
import ExpensesPage        from './pages/ExpensesPage';
import CardsPage           from './pages/CardsPage';
import SavingsPage         from './pages/SavingsPage';
import GoalsPage           from './pages/GoalsPage';
import SubscriptionsPage   from './pages/SubscriptionsPage';
import PurchaseSimulatorPage from './pages/PurchaseSimulatorPage';
import WhatIfSimulatorPage from './pages/WhatIfSimulatorPage';
import HistoryPage         from './pages/HistoryPage';
import TrendsPage          from './pages/TrendsPage';
import BudgetsPage         from './pages/BudgetsPage';
import InsightsPage        from './pages/InsightsPage';
import ReportsPage         from './pages/ReportsPage';
import SettingsPage        from './pages/SettingsPage';

// ── Error Boundary ─────────────────────────────────────────
// Captura qualquer erro de renderização e evita tela branca silenciosa.
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-bg flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl border border-danger/20 shadow-modal p-8 max-w-md w-full text-center">
            <div className="text-5xl mb-4">⚠</div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">Algo deu errado</h2>
            <p className="text-sm text-muted mb-6">{this.state.error?.message ?? 'Erro inesperado na aplicação.'}</p>
            <button onClick={() => { this.setState({ error: null }); window.location.reload(); }}
              className="bg-primary text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-primary-dark transition-colors">
              Recarregar
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Protected Route ────────────────────────────────────────
function ProtectedRoute({ children }) {
  const status = useAuthStore((s) => s.status);
  if (status === 'idle' || status === 'loading') {
    return (
      <div className="min-h-screen bg-bg flex flex-col items-center justify-center gap-4">
        <div className="h-10 w-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-muted font-medium">Carregando...</p>
      </div>
    );
  }
  if (status === 'unauthenticated') return <Navigate to="/login" replace />;
  return children;
}

// ── Auth Shell ─────────────────────────────────────────────
function AuthShell({ children }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex flex-col items-center justify-center p-4">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-info/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm animate-scale-in">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-3">
            <div className="h-11 w-11 bg-primary rounded-2xl flex items-center justify-center text-white font-bold text-xl shadow-glow">
              F
            </div>
            <span className="text-3xl font-bold text-white">FinançasPro</span>
          </div>
          <p className="text-slate-400 text-sm">Gestão financeira pessoal inteligente</p>
        </div>
        {children}
      </div>
      <ToastContainer />
    </div>
  );
}

// ── App ────────────────────────────────────────────────────
export default function App() {
  const bootstrap    = useAuthStore((s) => s.bootstrap);
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
        <Route path="/login"           element={<AuthShell><LoginPage /></AuthShell>} />
        <Route path="/register"        element={<AuthShell><RegisterPage /></AuthShell>} />
        <Route path="/forgot-password" element={<AuthShell><ForgotPasswordPage /></AuthShell>} />
        <Route path="/reset-password"  element={<AuthShell><ResetPasswordPage /></AuthShell>} />

        <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
          <Route path="/dashboard"          element={<ErrorBoundary><DashboardPage /></ErrorBoundary>} />
          <Route path="/incomes"            element={<ErrorBoundary><IncomesPage /></ErrorBoundary>} />
          <Route path="/expenses"           element={<ErrorBoundary><ExpensesPage /></ErrorBoundary>} />
          <Route path="/cards"              element={<ErrorBoundary><CardsPage /></ErrorBoundary>} />
          <Route path="/savings"            element={<ErrorBoundary><SavingsPage /></ErrorBoundary>} />
          <Route path="/goals"              element={<ErrorBoundary><GoalsPage /></ErrorBoundary>} />
          <Route path="/subscriptions"      element={<ErrorBoundary><SubscriptionsPage /></ErrorBoundary>} />
          <Route path="/simulator/purchase" element={<ErrorBoundary><PurchaseSimulatorPage /></ErrorBoundary>} />
          <Route path="/simulator/what-if"  element={<ErrorBoundary><WhatIfSimulatorPage /></ErrorBoundary>} />
          <Route path="/history"            element={<ErrorBoundary><HistoryPage /></ErrorBoundary>} />
          <Route path="/trends"             element={<ErrorBoundary><TrendsPage /></ErrorBoundary>} />
          <Route path="/budgets"            element={<ErrorBoundary><BudgetsPage /></ErrorBoundary>} />
          <Route path="/insights"           element={<ErrorBoundary><InsightsPage /></ErrorBoundary>} />
          <Route path="/reports"            element={<ErrorBoundary><ReportsPage /></ErrorBoundary>} />
          <Route path="/settings"           element={<ErrorBoundary><SettingsPage /></ErrorBoundary>} />
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}
