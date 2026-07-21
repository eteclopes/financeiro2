import { useState, useEffect, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useMonthStore } from '../store/monthStore';
import { behavioralAnalysisApi } from '../lib/services';
import { formatCurrency } from '../lib/format';
import { Card, CardHeader, Badge, Skeleton, TabGroup, AlertBanner } from '../components/ui/index';
import { IconUp, IconDown, IconScale } from '../components/icons';
import { useUIStore } from '../store/uiStore';
import { useThemeStore } from '../store/themeStore';

const PERIOD_TABS = [
  { value: 3,  label: '3 meses'  },
  { value: 6,  label: '6 meses'  },
  { value: 12, label: '12 meses' },
];

const TREND_META = {
  up:   { icon: IconUp,   label: 'Em alta',   className: 'text-danger-dark dark:text-danger-light bg-danger-subtle dark:bg-danger/10' },
  down: { icon: IconDown, label: 'Em queda',  className: 'text-primary-dark dark:text-primary-light bg-primary-subtle dark:bg-primary/10' },
  stable: { icon: IconScale, label: 'Estável', className: 'text-muted bg-subtle dark:bg-white/5' },
};

// Para receita, "up" é bom (verde) e "down" é ruim (vermelho) — o inverso
// de despesas/dívida/dependência de cartão, onde "up" é ruim.
const POSITIVE_META = {
  up:   { icon: IconUp,   label: 'Em alta',  className: 'text-primary-dark dark:text-primary-light bg-primary-subtle dark:bg-primary/10' },
  down: { icon: IconDown, label: 'Em queda', className: 'text-danger-dark dark:text-danger-light bg-danger-subtle dark:bg-danger/10' },
  stable: { icon: IconScale, label: 'Estável', className: 'text-muted bg-subtle dark:bg-white/5' },
};

function TrendChip({ direction, positiveIsGood = false }) {
  const meta = (positiveIsGood ? POSITIVE_META : TREND_META)[direction] ?? TREND_META.stable;
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-md ${meta.className}`}>
      <Icon size={12} /> {meta.label}
    </span>
  );
}

function MiniTrendCard({ title, data, dataKey, color, trend, positiveIsGood, formatValue }) {
  return (
    <Card>
      <div className="flex items-start justify-between mb-3">
        <h3 className="font-semibold text-sm text-slate-900 dark:text-zinc-50">{title}</h3>
        <TrendChip direction={trend} positiveIsGood={positiveIsGood} />
      </div>
      <div className="h-32">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ left: -20, top: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={38}
              tickFormatter={(v) => formatValue ? formatValue(v) : v} />
            <Tooltip formatter={(v) => formatValue ? formatValue(v) : v} />
            <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2.25} dot={{ r: 3, fill: color }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

const HIGHLIGHT_STYLE = { warning: 'warning', info: 'info', danger: 'danger', success: 'success' };

export default function TrendsPage() {
  const selectedMonthId = useMonthStore((s) => s.selectedMonthId);
  const [periods, setPeriods] = useState(6);
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const toast = useUIStore((s) => s);

  const load = useCallback(async () => {
    if (!selectedMonthId) return;
    setLoading(true);
    try {
      const r = await behavioralAnalysisApi.get(selectedMonthId, periods);
      setData(r.data);
    } catch { toast.error('Erro ao carregar tendências.'); }
    finally { setLoading(false); }
  }, [selectedMonthId, periods]);

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <div className="space-y-4 animate-pulse">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-48" />)}
      </div>
    </div>
  );

  if (!data || data.periods < 2) {
    return (
      <div className="space-y-4 animate-fade-in">
        <h2 className="font-bold text-xl text-slate-900 dark:text-zinc-50">Tendências</h2>
        <Card><p className="text-sm text-muted text-center py-8">
          Dados insuficientes para detectar tendências. Feche mais meses para começar a ver essa análise.
        </p></Card>
      </div>
    );
  }

  const labels = data.monthLabels.map((m) => `${String(m.month).padStart(2, '0')}/${String(m.year).slice(-2)}`);
  const incomeData   = data.income.series.map((v, i) => ({ name: labels[i], receita: v }));
  const expenseData  = data.expenses.series.map((v, i) => ({ name: labels[i], despesa: v }));
  const cardDepData  = data.cardDependency.series.map((v, i) => ({ name: labels[i], dependencia: v }));
  const debtData     = data.debtInstallments.series.map((v, i) => ({ name: labels[i], divida: v }));

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-bold text-xl text-slate-900 dark:text-zinc-50">Tendências</h2>
          <p className="text-sm text-muted mt-0.5">Para onde suas finanças estão indo, com base nos últimos meses</p>
        </div>
        <TabGroup tabs={PERIOD_TABS} value={periods} onChange={setPeriods} />
      </div>

      {/* Destaques automáticos */}
      <div className="space-y-2">
        {data.highlights.map((h, i) => (
          <AlertBanner key={i} type={HIGHLIGHT_STYLE[h.severity] ?? 'info'}>{h.text}</AlertBanner>
        ))}
      </div>

      {data.anomalyMonths?.length > 0 && (
        <Card>
          <CardHeader title="Meses com gasto fora do padrão" subtitle="Acima da média + 1,5 desvio-padrão" />
          <div className="flex flex-wrap gap-2">
            {data.anomalyMonths.map((m, i) => (
              <Badge key={i} variant="warning">
                {String(m.month).padStart(2, '0')}/{m.year} — {formatCurrency(m.value)}
              </Badge>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MiniTrendCard title="Receita" data={incomeData} dataKey="receita" color="#10B981"
          trend={data.income.trend} positiveIsGood formatValue={(v) => `${(v/1000).toFixed(1)}k`} />
        <MiniTrendCard title="Despesas" data={expenseData} dataKey="despesa" color="#EF4444"
          trend={data.expenses.trend} formatValue={(v) => `${(v/1000).toFixed(1)}k`} />
        <MiniTrendCard title="Dependência de cartão de crédito" data={cardDepData} dataKey="dependencia" color="#F59E0B"
          trend={data.cardDependency.trend} formatValue={(v) => `${v.toFixed(0)}%`} />
        <MiniTrendCard title="Parcelas de dívida" data={debtData} dataKey="divida" color="#8B5CF6"
          trend={data.debtInstallments.trend} formatValue={(v) => `${(v/1000).toFixed(1)}k`} />
      </div>

      <Card padding={false}>
        <div className="px-5 py-4 border-b border-border dark:border-white/[0.06]">
          <h3 className="font-semibold text-slate-900 dark:text-zinc-50">Tendência por categoria de despesa</h3>
          <p className="text-xs text-muted mt-0.5">Ordenado do maior para o menor crescimento no período</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-subtle/60 dark:bg-white/[0.03]">
              <tr>{['Categoria', 'Último mês', 'Variação', 'Tendência'].map((h) => (
                <th key={h} className="table-header">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-border/60 dark:divide-white/[0.06]">
              {data.categoryTrends.length === 0 ? (
                <tr><td colSpan={4} className="py-8 text-center text-muted text-sm">Sem despesas categorizadas no período.</td></tr>
              ) : data.categoryTrends.map((c) => (
                <tr key={c.categoryId} className="hover:bg-subtle/40 dark:hover:bg-white/[0.03] transition-colors">
                  <td className="table-cell font-semibold text-slate-800 dark:text-zinc-200">
                    {c.categoryName}
                    {c.excessive && <Badge variant="danger" className="ml-2">crescimento alto</Badge>}
                  </td>
                  <td className="table-cell font-mono tabular-nums">{formatCurrency(c.lastValue)}</td>
                  <td className="table-cell font-mono tabular-nums">
                    {c.growthPercent != null ? `${c.growthPercent > 0 ? '+' : ''}${c.growthPercent.toFixed(1)}%` : '—'}
                  </td>
                  <td className="table-cell"><TrendChip direction={c.trend} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
