import { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { useMonthStore } from '../store/monthStore';
import { dashboardApi, projectionsApi } from '../lib/services';
import { extractErrorMessage } from '../lib/api';
import { formatCurrency, formatShortDate } from '../lib/format';
import { Card, CardHeader, Badge, ProgressBar, Skeleton, EmptyState } from '../components/ui/index';
import { useUIStore } from '../store/uiStore';
import { useThemeStore } from '../store/themeStore';
import { QuickActions } from '../components/dashboard/QuickActions';
import { IconWallet, IconPiggy, IconAlert } from '../components/icons';

const COMMITMENT_COLOR = { saudavel: 'text-primary-dark dark:text-primary-light', atencao: 'text-warning-dark dark:text-warning-light', risco: 'text-warning-dark dark:text-warning-light', critico: 'text-danger-dark dark:text-danger-light' };
const COMMITMENT_BG    = { saudavel: 'bg-primary-muted dark:bg-primary/10', atencao: 'bg-warning-muted dark:bg-warning/10', risco: 'bg-warning-muted dark:bg-warning/10', critico: 'bg-danger-muted dark:bg-danger/10' };
const STATUS_MAP       = { pending: { l:'Pendente',v:'warning' }, partial: { l:'Parcial',v:'info' }, late: { l:'Atrasado',v:'danger' }, paid: { l:'Pago',v:'success' } };
const SCORE_COLOR      = (s) => s >= 75 ? '#10B981' : s >= 50 ? '#F59E0B' : '#EF4444';
const PIE_COLORS       = ['#10B981', '#3B82F6', '#8B5CF6', '#F59E0B', '#EF4444', '#06B6D4', '#EC4899'];

function ThemedTooltip({ active, payload, label }) {
  const theme = useThemeStore((s) => s.theme);
  if (!active || !payload?.length) return null;
  return (
    <div className={`rounded-xl p-3 shadow-modal text-xs border ${theme === 'dark' ? 'bg-panel-dark border-white/10' : 'bg-white border-border'}`}>
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
  const theme = useThemeStore((s) => s.theme);
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
      const [dash, p] = await Promise.all([
        dashboardApi.get(requestedMonthId),
        projectionsApi.get(requestedMonthId, 6).catch(() => ({ data: { projection: [] } })),
      ]);
      if (useMonthStore.getState().selectedMonthId !== requestedMonthId) return;
      setData(dash.data);
      setProj(p.data.projection ?? []);
    } catch (e) {
      if (useMonthStore.getState().selectedMonthId !== requestedMonthId) return;
      const msg = extractErrorMessage(e, 'Não foi possível carregar o dashboard.');
      setError(msg);
      errorToast(msg);
    } finally {
      if (useMonthStore.getState().selectedMonthId === requestedMonthId) setLoading(false);
    }
  }, [selectedMonthId]);

  useEffect(() => { load(); }, [load]);

  const month = getSelected();

  // Estado de carregando (mês ainda não inicializado)
  if (!selectedMonthId || loading) {
    return (
      <div className="space-y-5 animate-pulse">
        <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-4">
          <Skeleton className="h-40 rounded-3xl" />
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-20 rounded-2xl" />
            <Skeleton className="h-20 rounded-2xl" />
            <Skeleton className="h-20 rounded-2xl col-span-2" />
          </div>
        </div>
        <Skeleton className="h-14 rounded-2xl" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
    { name: 'Receita',  valor: data.incomeTotal },
    { name: 'Previsto', valor: data.expensesPlanned },
    { name: 'Pago',     valor: data.expensesPaid },
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
    <div className="space-y-5 animate-fade-in">
      {/* Saldo em destaque + demais valores */}
      <div data-tutorial="dashboard-summary" className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-4">
        {/* Hero: saldo atual */}
        <div className={`relative overflow-hidden rounded-3xl p-6 text-white shadow-premium dark:shadow-premium-dark animate-fade-in
          ${data.currentBalance >= 0 ? 'bg-gradient-to-br from-primary to-primary-dark' : 'bg-gradient-to-br from-danger to-danger-dark'}`}>
          <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/[0.08]" />
          <div className="absolute -bottom-16 -left-8 w-32 h-32 rounded-full bg-white/[0.06]" />
          <div className="relative">
            <p className="text-white/80 text-sm font-medium mb-1">Saldo atual</p>
            <p className="text-4xl font-bold font-mono tabular-nums tracking-tight">{formatCurrency(data.currentBalance)}</p>
            <div className="flex items-center gap-6 mt-4">
              <div>
                <p className="text-white/65 text-[11px] font-medium uppercase tracking-wide">Receita total</p>
                <p className="text-base font-semibold font-mono mt-0.5">{formatCurrency(data.incomeTotal)}</p>
              </div>
              <div className="w-px h-9 bg-white/15" />
              <div>
                <p className="text-white/65 text-[11px] font-medium uppercase tracking-wide">Projetado</p>
                <p className="text-base font-semibold font-mono mt-0.5">{formatCurrency(data.projectedBalance)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Grade 2x2: reserva, físico, dívida */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white dark:bg-panel-dark border border-border dark:border-white/[0.06] rounded-2xl p-4 shadow-card dark:shadow-premium-dark">
            <p className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <IconPiggy size={13} /> Reserva
            </p>
            <p className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-zinc-50">{formatCurrency(data.savingsBalance)}</p>
          </div>
          <div className="bg-white dark:bg-panel-dark border border-border dark:border-white/[0.06] rounded-2xl p-4 shadow-card dark:shadow-premium-dark">
            <p className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <IconWallet size={13} /> Físico
            </p>
            <p className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-zinc-50">{formatCurrency(data.physicalCash)}</p>
          </div>
          <div className="col-span-2 bg-white dark:bg-panel-dark border border-border dark:border-white/[0.06] rounded-2xl p-4 shadow-card dark:shadow-premium-dark flex items-center justify-between">
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
          </div>
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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
        <Card>
          <CardHeader title="Alertas" subtitle={`${activeAlerts.length} ativo(s)`} />
          {activeAlerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="text-3xl mb-2">✓</div>
              <p className="text-sm font-medium text-primary-dark dark:text-primary-light">Tudo em ordem!</p>
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

        {/* Recomendações */}
        <Card>
          <CardHeader title="Recomendações" />
          {(data.recommendations ?? []).length === 0 ? (
            <EmptyState icon="💡" title="Sem recomendações" description="Continue usando o sistema para gerar recomendações personalizadas." />
          ) : (
            <ul className="space-y-2">
              {(data.recommendations ?? []).slice(0, 4).map((r, i) => (
                <li key={i} className="p-3 rounded-xl bg-primary-subtle dark:bg-primary/10 border border-primary/15 text-xs">
                  <p className="font-semibold text-primary-dark dark:text-primary-light mb-0.5">{r.title}</p>
                  <p className="text-slate-600 dark:text-zinc-400 leading-relaxed">{r.description}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Comprometimento + Cartões + Vencimentos */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {data.commitment && (
          <Card>
            <CardHeader title="Comprometimento da Renda" />
            <div className={`text-center p-4 rounded-2xl mb-4 ${COMMITMENT_BG[data.commitment.band] ?? 'bg-subtle dark:bg-white/5'}`}>
              <p className={`text-4xl font-bold font-mono ${COMMITMENT_COLOR[data.commitment.band] ?? 'text-slate-900 dark:text-zinc-50'}`}>
                {Math.round(data.commitment.ratio * 100)}%
              </p>
              <p className={`text-sm font-semibold mt-1 ${COMMITMENT_COLOR[data.commitment.band] ?? 'text-slate-700 dark:text-zinc-300'}`}>
                {data.commitment.label}
              </p>
            </div>
            <ProgressBar value={data.commitment.ratio * 100} max={100} height="h-3"
              color={data.commitment.band === 'saudavel' ? 'primary' : data.commitment.band === 'critico' ? 'danger' : 'warning'} />
            <div className="grid grid-cols-2 gap-1 mt-3 text-xs text-muted">
              {[['primary','0–40% Saudável'],['warning','40–60% Atenção'],['warning','60–80% Risco'],['danger','80%+ Crítico']].map(([c,l]) => (
                <div key={l} className="flex items-center gap-1.5">
                  <div className={`w-2 h-2 rounded-full bg-${c}`} />
                  <span>{l}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

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
                          style={{ width: `${pct}%`, backgroundColor: card.color ?? '#10B981' }} />
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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-1">
          <CardHeader title="Receitas × Despesas" />
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData} margin={{ left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: axisColor }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: axisColor }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                <Tooltip content={<ThemedTooltip />} cursor={{ fill: theme === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }} />
                <defs>
                  <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10B981" stopOpacity={1} />
                    <stop offset="100%" stopColor="#10B981" stopOpacity={0.7} />
                  </linearGradient>
                </defs>
                <Bar dataKey="valor" fill="url(#barGradient)" radius={[8,8,0,0]} barSize={36} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader title="Projeção 6 meses" subtitle="Líquido mensal e acumulado" />
          <div className="h-52">
            {projData.length === 0
              ? <EmptyState icon="→" title="Sem dados de projeção" description="Feche o mês para gerar projeções futuras." />
              : <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={projData} margin={{ left: -20 }}>
                    <defs>
                      <linearGradient id="areaAcumulado" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10B981" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#10B981" stopOpacity={0} />
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
                    <Area type="monotone" dataKey="líquido" stroke="#3B82F6" strokeWidth={2} fill="url(#areaLiquido)" />
                    <Area type="monotone" dataKey="acumulado" stroke="#10B981" strokeWidth={2} fill="url(#areaAcumulado)" />
                  </AreaChart>
                </ResponsiveContainer>}
          </div>
        </Card>

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
      </div>

      {/* Metas */}
      {(data.goals ?? []).length > 0 && (
        <Card>
          <CardHeader title="Metas Ativas" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.goals.map((g) => (
              <div key={g.id} className="bg-subtle dark:bg-white/[0.04] rounded-2xl p-4 transition-all duration-200 hover:bg-subtle/70 dark:hover:bg-white/[0.06]">
                <p className="text-sm font-semibold text-slate-800 dark:text-zinc-200 mb-3">{g.name}</p>
                <ProgressBar value={g.progress} max={Number(g.targetValue)} height="h-2.5" />
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
    </div>
  );
}