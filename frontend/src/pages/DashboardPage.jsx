import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { useMonthStore } from '../store/monthStore';
import { dashboardApi, dashboardPreferencesApi, projectionsApi } from '../lib/services';
import { extractErrorMessage } from '../lib/api';
import { formatCurrency, formatShortDate } from '../lib/format';
import { Card, CardHeader, Badge, Button, ProgressBar, Skeleton, EmptyState } from '../components/ui/index';
import { AnimatedNumber, SegmentedControl, Spotlight, ToggleSwitch } from '../components/ui/Motion';
import { useUIStore } from '../store/uiStore';
import { useThemeStore } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';
import { QuickActions } from '../components/dashboard/QuickActions';
import { Modal } from '../components/ui/Modal';
import { IconWallet, IconPiggy, IconAlert } from '../components/icons';

const COMMITMENT_COLOR = { saudavel: 'text-success-dark dark:text-success-light', atencao: 'text-warning-dark dark:text-warning-light', risco: 'text-warning-dark dark:text-warning-light', critico: 'text-danger-dark dark:text-danger-light' };
const COMMITMENT_BG    = { saudavel: 'bg-success-muted dark:bg-success/10', atencao: 'bg-warning-muted dark:bg-warning/10', risco: 'bg-warning-muted dark:bg-warning/10', critico: 'bg-danger-muted dark:bg-danger/10' };
const STATUS_MAP       = { pending: { l:'Pendente',v:'warning' }, partial: { l:'Parcial',v:'info' }, late: { l:'Atrasado',v:'danger' }, paid: { l:'Pago',v:'success' } };
const SCORE_COLOR      = (s) => s >= 75 ? '#16A34A' : s >= 50 ? '#F59E0B' : '#EF4444';
const PIE_COLORS       = ['#7C3AED', '#2563EB', '#16A34A', '#F59E0B', '#DC2626', '#A855F7', '#06B6D4'];

const DEFAULT_DASHBOARD_PREFERENCES = Object.freeze({
  showSummaryChart: true,
  showAlerts: true,
  showRecommendations: true,
  showCards: true,
  showProjections: true,
  showCategoryChart: true,
  showGoals: true,
  summaryChart: 'bars',
  projectionView: 'area',
});

function ThemedTooltip({ active, payload, label }) {
  const theme = useThemeStore((s) => s.theme);
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <p className={`font-semibold mb-1 ${theme === 'dark' ? 'text-zinc-200' : 'text-slate-700'}`}>{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey ?? p.name} style={{ color: p.color ?? p.payload?.fill }}>{p.name ?? p.dataKey}: {formatCurrency(p.value)}</p>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const selectedMonthId = useMonthStore((s) => s.selectedMonthId);
  const getSelected     = useMonthStore((s) => s.getSelectedMonth);
  const [data, setData]       = useState(null);
  const [proj, setProj]       = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const errorToast = useUIStore((s) => s.error);
  const successToast = useUIStore((s) => s.success);
  const theme = useThemeStore((s) => s.theme);
  const isPro = useAuthStore((s) => Boolean(s.user?.isPro));
  const [summaryChart, setSummaryChart] = useState('bars');
  const [projectionView, setProjectionView] = useState('area');
  const [preferences, setPreferences] = useState({ ...DEFAULT_DASHBOARD_PREFERENCES });
  const [preferenceDraft, setPreferenceDraft] = useState({ ...DEFAULT_DASHBOARD_PREFERENCES });
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [savingPreferences, setSavingPreferences] = useState(false);
  // Recharts não lê variáveis CSS/Tailwind diretamente em props como
  // `stroke`/`fill` — por isso as cores de grade e eixo são derivadas do
  // tema aqui e passadas como valor literal para cada gráfico.
  const gridStroke = theme === 'dark' ? 'rgba(255,255,255,0.06)' : '#F1F5F9';
  const axisColor  = theme === 'dark' ? '#71717A' : '#94A3B8';

  const load = useCallback(async () => {
    if (!selectedMonthId) return;
    // Guarda qual mês esta chamada está buscando. Se `selectedMonthId`
    // mudar de novo (ex.: ao fechar o mês, que troca o mês selecionado
    // logo em seguida) antes desta resposta voltar, e ela chegar DEPOIS de
    // uma busca mais nova, isso evita que os dados do mês antigo
    // sobrescrevam os dados do mês certo já mostrados na tela.
    const requestedMonthId = selectedMonthId;
    setLoading(true);
    setError(null);
    try {
      const [dash, p, pref] = await Promise.all([
        dashboardApi.get(requestedMonthId),
        isPro
          ? projectionsApi.get(requestedMonthId, 6).catch(() => ({ data: { projection: [] } }))
          : Promise.resolve({ data: { projection: [] } }),
        isPro
          ? dashboardPreferencesApi.get().catch(() => ({ data: { preferences: DEFAULT_DASHBOARD_PREFERENCES } }))
          : Promise.resolve({ data: { preferences: DEFAULT_DASHBOARD_PREFERENCES } }),
      ]);
      if (useMonthStore.getState().selectedMonthId !== requestedMonthId) return;
      const loadedPreferences = { ...DEFAULT_DASHBOARD_PREFERENCES, ...(pref.data.preferences ?? {}) };
      setData(dash.data);
      setProj(p.data.projection ?? []);
      setPreferences(loadedPreferences);
      setPreferenceDraft(loadedPreferences);
      setSummaryChart(loadedPreferences.summaryChart);
      setProjectionView(loadedPreferences.projectionView);
    } catch (e) {
      if (useMonthStore.getState().selectedMonthId !== requestedMonthId) return;
      const msg = extractErrorMessage(e, 'Não foi possível carregar o dashboard.');
      setError(msg);
      errorToast(msg);
    } finally {
      if (useMonthStore.getState().selectedMonthId === requestedMonthId) setLoading(false);
    }
  }, [selectedMonthId, isPro]);

  useEffect(() => { load(); }, [load]);

  const openPreferences = () => {
    setPreferenceDraft({ ...preferences, summaryChart, projectionView });
    setPreferencesOpen(true);
  };

  const savePreferences = async () => {
    if (!isPro) return;
    setSavingPreferences(true);
    try {
      const response = await dashboardPreferencesApi.update(preferenceDraft);
      const saved = { ...DEFAULT_DASHBOARD_PREFERENCES, ...(response.data.preferences ?? preferenceDraft) };
      setPreferences(saved);
      setPreferenceDraft(saved);
      setSummaryChart(saved.summaryChart);
      setProjectionView(saved.projectionView);
      setPreferencesOpen(false);
      successToast('Dashboard personalizado e salvo.');
    } catch (e) {
      errorToast(extractErrorMessage(e, 'Não foi possível salvar a personalização.'));
    } finally {
      setSavingPreferences(false);
    }
  };

  const month = getSelected();

  // Estado de carregando (mês ainda não inicializado)
  if (!selectedMonthId || loading) {
    return (
      <div className="space-y-5 animate-pulse">
        <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-4">
          <Skeleton className="h-40 rounded-3xl" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Skeleton className="h-20 rounded-2xl" />
            <Skeleton className="h-20 rounded-2xl" />
            <Skeleton className="h-20 rounded-2xl sm:col-span-2" />
          </div>
        </div>
        <Skeleton className="h-14 rounded-2xl" />
        <div className="auto-grid-comfortable">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-60" />)}
        </div>
      </div>
    );
  }

  // Estado de erro
  if (error && !data) {
    return (
      <EmptyState icon="⚠" title="Erro ao carregar dashboard" description={error}
        action={<button onClick={load} className="bg-primary text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-primary-dark transition-colors">Tentar novamente</button>} />
    );
  }

  if (!data) return null;

  const health       = data.financialHealthScore;
  const activeAlerts = (data.alerts ?? []).filter((a) => !a.resolvedAt);
  const barData      = [
    { name: 'Receita', valor: data.incomeTotal, color: '#7C3AED' },
    { name: 'Previsto', valor: data.expensesPlanned, color: '#F59E0B' },
    { name: 'Pago', valor: data.expensesPaid, color: '#DC2626' },
  ];
  const projData = proj.map((p) => ({
    name:      String(p.month).padStart(2,'0') + '/' + String(p.year).slice(-2),
    líquido:   p.netProjected,
    acumulado: p.cumulativeNet,
  }));

  // Agrupamento por categoria feito localmente a partir dos vencimentos já
  // carregados no próprio payload do dashboard (data.upcomingDueDates) —
  // nenhuma chamada de API nova foi adicionada para isso.
  const categoryTotals = {};
  for (const e of data.upcomingDueDates ?? []) {
    const name = e.category?.name ?? 'Outros';
    categoryTotals[name] = (categoryTotals[name] ?? 0) + Number(e.value ?? 0);
  }
  const categoryPieData = Object.entries(categoryTotals)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  return (
    <div data-tutorial-page-ready="dashboard" className="space-y-6 animate-page-enter">
      {isPro && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/15 bg-primary-subtle/70 px-4 py-3 dark:bg-primary/10">
          <div>
            <p className="text-sm font-bold text-primary-dark dark:text-primary-light">Dashboard Pro personalizado</p>
            <p className="text-xs text-slate-600 dark:text-zinc-400">Escolha seções e tipos de gráfico; as preferências ficam salvas na sua conta.</p>
          </div>
          <Button variant="outline" size="sm" onClick={openPreferences}>Personalizar Dashboard</Button>
        </div>
      )}
      {/* Saldo em destaque + demais valores */}
      <div data-tutorial="dashboard-summary" className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-4">
        {/* Hero: saldo atual */}
        <div className={`financial-hero relative overflow-hidden rounded-3xl p-6 text-white shadow-floating dark:shadow-premium-dark animate-fade-in border border-white/10
          ${data.currentBalance >= 0 ? 'bg-gradient-to-br from-primary via-primary-light to-primary-dark' : 'bg-gradient-to-br from-danger via-red-500 to-danger-dark'}`}>
          <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/[0.08]" />
          <div className="absolute -bottom-16 -left-8 w-32 h-32 rounded-full bg-white/[0.06]" />
          <div className="hero-orbit" aria-hidden="true">
            <span className="hero-orbit-ring"><i className="hero-orbit-dot" /></span>
            <span className="hero-orbit-ring"><i className="hero-orbit-dot" /></span>
            <span className="hero-orbit-ring"><i className="hero-orbit-dot" /></span>
          </div>
          <div className="relative">
            <p className="text-white/80 text-sm font-medium mb-1">Saldo disponível acumulado</p>
            <p className="responsive-money font-bold font-mono tracking-tight"><AnimatedNumber value={data.currentBalance} formatter={formatCurrency} /></p>
            <p className="text-white/65 text-xs mt-1">O valor restante dos meses anteriores continua no seu caixa.</p>
            <div className="hero-mini-bars mt-4" aria-hidden="true">
              {[35, 68, 48, 82, 62, 96, 75].map((height, index) => <span key={index} style={{ height: `${height}%` }} />)}
            </div>
            <div className="flex items-center gap-4 mt-4 flex-wrap">
              <div>
                <p className="text-white/65 text-[11px] font-medium uppercase tracking-wide">Saldo trazido</p>
                <p className="text-base font-semibold font-mono mt-0.5">{formatCurrency(data.openingBalance)}</p>
              </div>
              <div className="w-px h-9 bg-white/20" />
              <div>
                <p className="text-white/65 text-[11px] font-medium uppercase tracking-wide">Receitas do mês</p>
                <p className="text-base font-semibold font-mono mt-0.5">{formatCurrency(data.incomeTotal)}</p>
              </div>
              <div className="w-px h-9 bg-white/20" />
              <div>
                <p className="text-white/65 text-[11px] font-medium uppercase tracking-wide">Após pendências</p>
                <p className="text-base font-semibold font-mono mt-0.5">{formatCurrency(data.projectedBalance)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Grade 2x2: reserva, físico, dívida */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Spotlight className="premium-card premium-card-hover p-4">
            <p className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <IconPiggy size={13} /> Reserva
            </p>
            <p className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-zinc-50">{formatCurrency(data.savingsBalance)}</p>
          </Spotlight>
          <Spotlight className="premium-card premium-card-hover p-4">
            <p className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <IconWallet size={13} /> Físico
            </p>
            <p className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-zinc-50">{formatCurrency(data.physicalCash)}</p>
          </Spotlight>
          <Spotlight className="sm:col-span-2 premium-card premium-card-hover p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <IconAlert size={13} /> Dívida ativa
              </p>
              <p className={`text-lg font-bold font-mono tabular-nums ${data.totalActiveDebt > 0 ? 'text-danger-dark dark:text-danger-light' : 'text-slate-900 dark:text-zinc-50'}`}>
                {formatCurrency(data.totalActiveDebt)}
              </p>
            </div>
            {data.totalActiveDebt > 0 && (
              <span className="text-[11px] font-semibold bg-danger-subtle dark:bg-danger/10 text-danger-dark dark:text-danger-light px-2.5 py-1 rounded-full">
                {(data.upcomingDueDates ?? []).filter((e) => e.type === 'priority').length} parcela(s)
              </span>
            )}
          </Spotlight>
        </div>
      </div>

      {/* Ações Rápidas */}
      <Card data-tutorial="quick-actions">
        <CardHeader title="Ações Rápidas" subtitle="Registre rapidamente sem sair do dashboard" className="mb-4" />
        <QuickActions
          onRefresh={load}
          pendingExpenses={data.upcomingDueDates ?? []}
          cards={data.cards ?? []}
          goals={data.goals ?? []}
          monthStatus={month?.status}
        />
      </Card>

      {/* Linha: Saúde + Alertas + Recomendações */}
      <div className="auto-grid-comfortable">
        {/* Saúde Financeira */}
        <Card data-tutorial="financial-health">
          <CardHeader title="Saúde Financeira" />
          {health ? (
            <div>
              <div className="flex items-center gap-4 mb-5">
                <div className="relative h-20 w-20 shrink-0">
                  <svg viewBox="0 0 36 36" className="h-20 w-20 -rotate-90">
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke={theme === 'dark' ? '#27272A' : '#F1F5F9'} strokeWidth="3" />
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke={SCORE_COLOR(health.score)} strokeWidth="3"
                      strokeDasharray={`${health.score} ${100 - health.score}`} strokeLinecap="round" className="transition-all duration-700 ease-smooth" />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-xl font-bold font-mono" style={{ color: SCORE_COLOR(health.score) }}>{health.score}</span>
                  </div>
                </div>
                <div>
                  <p className="font-semibold text-slate-900 dark:text-zinc-50">de 100 pontos</p>
                  <Badge variant={health.score >= 75 ? 'success' : health.score >= 50 ? 'warning' : 'danger'} className="mt-1">
                    {health.score >= 75 ? 'Boa saúde' : health.score >= 50 ? 'Regular' : 'Atenção'}
                  </Badge>
                </div>
              </div>
              <ul className="space-y-2">
                {health.breakdown && Object.values(health.breakdown).map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    <span className={`mt-0.5 shrink-0 text-base leading-none ${f.points >= f.max * 0.6 ? 'text-primary' : f.points > 0 ? 'text-warning' : 'text-danger'}`}>
                      {f.points >= f.max * 0.6 ? '✓' : '⚠'}
                    </span>
                    <span className="text-slate-600 dark:text-zinc-400 flex-1 leading-relaxed">{f.reason}</span>
                    <span className="font-mono text-muted shrink-0">{f.points}/{f.max}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : <EmptyState icon="◎" title="Sem dados" description="Adicione movimentações para calcular." />}
        </Card>

        {/* Alertas */}
        {preferences.showAlerts && (
          <Card>
          <CardHeader title="Alertas" subtitle={`${activeAlerts.length} ativo(s)`} />
          {activeAlerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="text-3xl mb-2">✓</div>
              <p className="text-sm font-medium text-success-dark dark:text-success-light">Tudo em ordem!</p>
              <p className="text-xs text-muted mt-1">Nenhum alerta ativo</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {activeAlerts.map((a) => (
                <li key={a.id} className={`flex items-start gap-2.5 p-2.5 rounded-xl text-xs ${a.severity === 'critical' ? 'bg-danger-subtle dark:bg-danger/10 border border-danger/20' : a.severity === 'warning' ? 'bg-warning-subtle dark:bg-warning/10 border border-warning/20' : 'bg-info-subtle dark:bg-info/10 border border-info/20'}`}>
                  <span className="mt-0.5 shrink-0">{a.severity === 'critical' ? '🔴' : a.severity === 'warning' ? '🟡' : '🔵'}</span>
                  <span className="text-slate-700 dark:text-zinc-300 leading-relaxed">{a.message}</span>
                </li>
              ))}
            </ul>
          )}
          </Card>
        )}

        {/* Recomendações */}
        {preferences.showRecommendations && (
          <Card>
          <CardHeader title="Recomendações" actions={!isPro ? <Badge variant="purple">PRO</Badge> : null} />
          {!isPro ? (
            <div className="rounded-2xl border border-primary/20 bg-primary-subtle p-4 dark:bg-primary/10">
              <p className="text-sm font-bold text-primary-dark dark:text-primary-light">Dicas personalizadas com base nos seus dados</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-zinc-400">O Básico mantém alertas e controle completo. O Pro analisa padrões e sugere ações para melhorar seu mês.</p>
              <Link to="/plan" className="mt-3 inline-flex text-xs font-bold text-primary-dark hover:underline dark:text-primary-light">Conhecer o Pro →</Link>
            </div>
          ) : (data.recommendations ?? []).length === 0 ? (
            <EmptyState icon="💡" title="Sem recomendações" description="Continue usando o sistema para gerar recomendações personalizadas." />
          ) : (
            <ul className="space-y-2">
              {(data.recommendations ?? []).slice(0, 4).map((r, i) => (
                <li key={i} className="p-3 rounded-xl bg-primary-subtle dark:bg-primary/10 border border-primary/20 text-xs">
                  <p className="font-semibold text-primary-dark dark:text-primary-light mb-0.5">{r.title}</p>
                  <p className="text-slate-600 dark:text-zinc-400 leading-relaxed">{r.description}</p>
                </li>
              ))}
            </ul>
          )}
          </Card>
        )}

      </div>

      {/* Comprometimento + Cartões + Vencimentos */}
      <div className="auto-grid-comfortable">
        {data.commitment && (
          <Card>
            <CardHeader title="Comprometimento da Renda" />
            <div className={`text-center p-4 rounded-2xl mb-4 ${COMMITMENT_BG[data.commitment.band] ?? 'bg-subtle dark:bg-white/5'}`}>
              <p className={`responsive-money font-bold font-mono ${COMMITMENT_COLOR[data.commitment.band] ?? 'text-slate-900 dark:text-zinc-50'}`}>
                {Math.round(data.commitment.ratio * 100)}%
              </p>
              <p className={`text-sm font-semibold mt-1 ${COMMITMENT_COLOR[data.commitment.band] ?? 'text-slate-700 dark:text-zinc-300'}`}>
                {data.commitment.label}
              </p>
            </div>
            <ProgressBar value={data.commitment.ratio * 100} max={100} height="h-3"
              color={data.commitment.band === 'saudavel' ? 'success' : data.commitment.band === 'critico' ? 'danger' : 'warning'} />
            <div className="grid grid-cols-2 gap-1 mt-3 text-xs text-muted">
              {[['success','0–40% Saudável'],['warning','40–60% Atenção'],['warning','60–80% Risco'],['danger','80%+ Crítico']].map(([c,l]) => (
                <div key={l} className="flex items-center gap-1.5">
                  <div className={`w-2 h-2 rounded-full ${c === 'success' ? 'bg-success' : c === 'warning' ? 'bg-warning' : 'bg-danger'}`} />
                  <span>{l}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {preferences.showCards && (
          <Card>
          <CardHeader title="Cartões de Crédito" />
          {(data.cards ?? []).length === 0
            ? <EmptyState icon="▣" title="Sem cartões" description="Cadastre um cartão de crédito." />
            : <div className="space-y-4">
                {data.cards.map((card) => {
                  const pct = Math.min(Math.round((card.usedLimit / Number(card.limitValue)) * 100), 100);
                  return (
                    <div key={card.id}>
                      <div className="flex justify-between text-xs mb-1.5">
                        <span className="font-semibold text-slate-800 dark:text-zinc-200">{card.name}</span>
                        <span className="text-muted font-mono">{pct}% usado</span>
                      </div>
                      <div className="h-2 w-full bg-subtle dark:bg-white/5 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${pct}%`, backgroundColor: card.color ?? '#7C3AED' }} />
                      </div>
                      <div className="flex justify-between mt-1 text-[10px] text-muted font-mono">
                        <span>{formatCurrency(card.usedLimit)}</span>
                        <span>{formatCurrency(card.limitValue)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>}
          </Card>
        )}

        <Card>
          <CardHeader title="Próximos Vencimentos" subtitle={`${data.pendingExpensesCount} pendente(s)`} />
          {(data.upcomingDueDates ?? []).length === 0
            ? <EmptyState icon="✓" title="Nada pendente" description="Sem vencimentos neste mês." />
            : <ul className="divide-y divide-border/60 dark:divide-white/[0.06]">
                {data.upcomingDueDates.map((e) => {
                  const s = STATUS_MAP[e.status] ?? { l: e.status, v: 'default' };
                  return (
                    <li key={e.id} className="flex items-center justify-between py-3 gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-800 dark:text-zinc-200 truncate">{e.description}</p>
                        <p className="text-[10px] text-muted">{formatShortDate(e.dueDate)}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs font-mono tabular-nums font-semibold">{formatCurrency(e.value)}</p>
                        <Badge variant={s.v}>{s.l}</Badge>
                      </div>
                    </li>
                  );
                })}
              </ul>}
        </Card>
      </div>

      {/* Gráficos */}
      <div className="auto-grid-comfortable">
        {preferences.showSummaryChart && (
          <Card className="lg:col-span-1">
          <CardHeader title="Receitas × Despesas" subtitle="Alterne a leitura do mês" actions={<SegmentedControl value={summaryChart} onChange={setSummaryChart} options={[{ value:'bars', label:'Barras', icon:'▥' }, { value:'area', label:'Fluxo', icon:'⌁' }]} />} />
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              {summaryChart === 'bars' ? (
                <BarChart data={barData} margin={{ left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: axisColor }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: axisColor }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                  <Tooltip content={<ThemedTooltip />} cursor={{ fill: theme === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }} />
                  <Bar dataKey="valor" radius={[10,10,4,4]} barSize={36} animationDuration={850}>
                    {barData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                  </Bar>
                </BarChart>
              ) : (
                <AreaChart data={barData} margin={{ left: -20, right: 8 }}>
                  <defs>
                    <linearGradient id="summaryFlow" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#7C3AED" stopOpacity={0.38} />
                      <stop offset="100%" stopColor="#7C3AED" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: axisColor }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: axisColor }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                  <Tooltip content={<ThemedTooltip />} />
                  <Area type="monotone" dataKey="valor" stroke="#7C3AED" strokeWidth={3} fill="url(#summaryFlow)" animationDuration={900} activeDot={{ r: 6, strokeWidth: 3, stroke: '#FFFFFF' }} />
                </AreaChart>
              )}
            </ResponsiveContainer>
          </div>
          </Card>
        )}

        {preferences.showProjections && (
          <Card className="lg:col-span-1">
          <CardHeader title="Projeção 6 meses" subtitle="Líquido mensal e acumulado" actions={isPro ? <SegmentedControl value={projectionView} onChange={setProjectionView} options={[{ value:'area', label:'Área' }, { value:'line', label:'Linhas' }]} /> : <Badge variant="purple">PRO</Badge>} />
          <div className="h-52">
            {!isPro
              ? <div className="grid h-full place-items-center rounded-2xl border border-primary/20 bg-primary-subtle p-5 text-center dark:bg-primary/10"><div><Badge variant="purple">PRO</Badge><p className="mt-3 text-sm font-bold text-primary-dark dark:text-primary-light">Antecipe os próximos 6 meses</p><p className="mt-1 text-xs text-slate-600 dark:text-zinc-400">Veja saldo líquido e acumulado antes das decisões.</p><Link to="/plan" className="mt-3 inline-flex text-xs font-bold text-primary-dark hover:underline dark:text-primary-light">Liberar projeções →</Link></div></div>
              : projData.length === 0
              ? <EmptyState icon="→" title="Sem dados de projeção" description="Feche o mês para gerar projeções futuras." />
              : <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={projData} margin={{ left: -20 }}>
                    <defs>
                      <linearGradient id="areaAcumulado" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#16A34A" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#16A34A" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="areaLiquido" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="#3B82F6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: axisColor }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: axisColor }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                    <Tooltip content={<ThemedTooltip />} />
                    {projectionView === 'area' ? (<>
                      <Area type="monotone" dataKey="líquido" stroke="#3B82F6" strokeWidth={2.5} fill="url(#areaLiquido)" animationDuration={900} />
                      <Area type="monotone" dataKey="acumulado" stroke="#16A34A" strokeWidth={2.5} fill="url(#areaAcumulado)" animationDuration={1100} />
                    </>) : (<>
                      <Line type="monotone" dataKey="líquido" stroke="#3B82F6" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 6 }} animationDuration={900} />
                      <Line type="monotone" dataKey="acumulado" stroke="#16A34A" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 6 }} animationDuration={1100} />
                    </>)}
                  </AreaChart>
                </ResponsiveContainer>}
          </div>
          </Card>
        )}

        {preferences.showCategoryChart && (
          <Card className="lg:col-span-1">
          <CardHeader title="Por Categoria" subtitle="Próximos vencimentos" />
          <div className="h-52">
            {categoryPieData.length === 0
              ? <EmptyState icon="◐" title="Sem dados" description="Sem despesas pendentes para agrupar." />
              : <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={categoryPieData} dataKey="value" nameKey="name" innerRadius={42} outerRadius={68} paddingAngle={3} strokeWidth={0}>
                      {categoryPieData.map((entry, i) => (
                        <Cell key={entry.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<ThemedTooltip />} />
                  </PieChart>
                </ResponsiveContainer>}
          </div>
          {categoryPieData.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {categoryPieData.slice(0, 5).map((c, i) => (
                <span key={c.name} className="inline-flex items-center gap-1.5 text-[11px] text-muted">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                  {c.name}
                </span>
              ))}
            </div>
          )}
          </Card>
        )}
      </div>

      {/* Metas */}
      {preferences.showGoals && (data.goals ?? []).length > 0 && (
        <Card>
          <CardHeader title="Metas Ativas" />
          <div className="auto-grid-comfortable">
            {data.goals.map((g) => (
              <div key={g.id} className="bg-subtle dark:bg-white/[0.04] rounded-2xl p-4 transition-all duration-200 hover:bg-subtle/70 dark:hover:bg-white/[0.06]">
                <p className="text-sm font-semibold text-slate-800 dark:text-zinc-200 mb-3">{g.name}</p>
                <ProgressBar value={g.progress} max={Number(g.targetValue)} height="h-2.5" color="success" />
                <div className="flex justify-between text-xs text-muted mt-2">
                  <span>{formatCurrency(g.progress)}</span>
                  <span className="font-semibold text-slate-700 dark:text-zinc-300">{Math.round(g.percentage)}%</span>
                  <span>{formatCurrency(g.targetValue)}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Modal open={preferencesOpen} onClose={() => setPreferencesOpen(false)} title="Personalizar Dashboard" size="lg">
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {[
              ['showSummaryChart', 'Receitas × Despesas', 'Resumo visual do mês.'],
              ['showAlerts', 'Alertas', 'Avisos de vencimento e risco.'],
              ['showRecommendations', 'Recomendações', 'Sugestões financeiras Pro.'],
              ['showCards', 'Cartões', 'Uso de limite no Dashboard.'],
              ['showProjections', 'Projeções', 'Visão financeira dos próximos meses.'],
              ['showCategoryChart', 'Categorias', 'Distribuição dos próximos vencimentos.'],
              ['showGoals', 'Metas', 'Progresso das metas ativas.'],
            ].map(([key, label, description]) => (
              <ToggleSwitch
                key={key}
                checked={Boolean(preferenceDraft[key])}
                onChange={(checked) => setPreferenceDraft((current) => ({ ...current, [key]: checked }))}
                label={label}
                description={description}
              />
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 border-t border-border/70 pt-5 sm:grid-cols-2 dark:border-white/[0.07]">
            <label className="block text-sm font-semibold text-slate-700 dark:text-zinc-300">
              Gráfico de receitas e despesas
              <select
                className="input-base mt-1.5"
                value={preferenceDraft.summaryChart}
                onChange={(event) => setPreferenceDraft((current) => ({ ...current, summaryChart: event.target.value }))}
              >
                <option value="bars">Barras</option>
                <option value="area">Fluxo em área</option>
              </select>
            </label>
            <label className="block text-sm font-semibold text-slate-700 dark:text-zinc-300">
              Gráfico de projeção
              <select
                className="input-base mt-1.5"
                value={preferenceDraft.projectionView}
                onChange={(event) => setPreferenceDraft((current) => ({ ...current, projectionView: event.target.value }))}
              >
                <option value="area">Área</option>
                <option value="line">Linhas</option>
              </select>
            </label>
          </div>

          <div className="modal-actions">
            <Button variant="outline" onClick={() => setPreferencesOpen(false)} disabled={savingPreferences}>Cancelar</Button>
            <Button onClick={savePreferences} loading={savingPreferences}>Salvar personalização</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}