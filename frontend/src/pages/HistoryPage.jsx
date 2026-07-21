import { useState, useEffect, useCallback } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { useMonthStore } from '../store/monthStore';
import { historyApi } from '../lib/services';
import { formatCurrency } from '../lib/format';
import { Card, CardHeader, Badge, Skeleton, TabGroup } from '../components/ui/index';
import { useUIStore } from '../store/uiStore';
import { useThemeStore } from '../store/themeStore';

const PERIOD_TABS = [
  { value: 3,  label: '3 meses'  },
  { value: 6,  label: '6 meses'  },
  { value: 12, label: '12 meses' },
];

function CustomTooltip({ active, payload, label }) {
  const theme = useThemeStore((s) => s.theme);
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <p className="font-semibold text-slate-700 dark:text-zinc-300 mb-2">{label}</p>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-muted capitalize">{p.name ?? p.dataKey}:</span>
          <span className="font-mono font-bold" style={{ color: p.color }}>{formatCurrency(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export default function HistoryPage() {
  const selectedMonthId = useMonthStore((s) => s.selectedMonthId);
  const [period, setPeriod]   = useState(6);
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const toast = useUIStore((s) => s);
  const theme = useThemeStore((s) => s.theme);
  const gridStroke = theme === 'dark' ? 'rgba(255,255,255,0.06)' : '#F1F5F9';
  const axisColor  = theme === 'dark' ? '#71717A' : '#94A3B8';

  const load = useCallback(async () => {
    if (!selectedMonthId) return;
    setLoading(true);
    try { const r = await historyApi.get(selectedMonthId, period); setData(r.data); }
    catch { toast.error('Erro ao carregar histórico.'); }
    finally { setLoading(false); }
  }, [selectedMonthId, period]);

  useEffect(() => { load(); }, [load]);

  const months = data?.months ?? [];
  const chartData = months.map((m) => ({
    name: `${String(m.month).padStart(2,'0')}/${String(m.year).slice(-2)}`,
    receita: m.income, despesas: m.paidExpenses, líquido: m.netBalance, acumulado: m.cumulativeBalance, dívidas: m.debtInstallments,
  }));
  const healthData = months.filter((m) => m.healthScore != null).map((m) => ({
    name: `${String(m.month).padStart(2,'0')}/${String(m.year).slice(-2)}`, saúde: m.healthScore,
  }));

  if (loading) return (
    <div className="space-y-4 animate-pulse">
      <div className="grid grid-cols-3 gap-3">{Array.from({length:3}).map((_,i)=><Skeleton key={i} className="h-24" />)}</div>
      {Array.from({length:3}).map((_,i)=><Skeleton key={i} className="h-56" />)}
    </div>
  );

  return (
    <div className="space-y-6 animate-page-enter">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-[-0.025em] text-slate-950 dark:text-white">Histórico Financeiro</h2>
          <p className="text-sm text-muted mt-0.5">Comparação e evolução ao longo do tempo</p>
        </div>
        <TabGroup tabs={PERIOD_TABS} value={period} onChange={setPeriod} />
      </div>

      {!data || months.length === 0 ? (
        <Card><p className="text-sm text-muted text-center py-8">Nenhum dado disponível para o período. Feche alguns meses para ver o histórico.</p></Card>
      ) : (
        <>
          {/* Resumo */}
          {data.summary && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label:'Receita média',    value: data.summary.avgIncome,        color:'text-primary-dark' },
                { label:'Despesa média',    value: data.summary.avgExpenses,      color:'text-danger-dark' },
                { label:'Saldo disponível', value: data.summary.endingBalance, color: data.summary.endingBalance >= 0 ? 'text-success-dark dark:text-success-light' : 'text-danger-dark' },
                { label:'Melhor mês',       value: data.summary.bestMonthNet?.netBalance, color:'text-primary-dark',
                  sub: data.summary.bestMonthNet ? `${String(data.summary.bestMonthNet.month).padStart(2,'0')}/${data.summary.bestMonthNet.year}` : '—' },
              ].map((item) => (
                <Card key={item.label} className="!p-4">
                  <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">{item.label}</p>
                  <p className={`text-xl font-bold font-mono tabular-nums ${item.color}`}>{item.value != null ? formatCurrency(item.value) : '—'}</p>
                  {item.sub && <p className="text-xs text-muted mt-0.5">{item.sub}</p>}
                </Card>
              ))}
            </div>
          )}

          {/* Receitas vs Despesas */}
          <Card>
            <CardHeader title="Receitas × Despesas" subtitle={`${months.length} meses`} />
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize:11, fill:axisColor }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize:11, fill:axisColor }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  <Bar dataKey="receita"  fill="#7C3AED" radius={[4,4,0,0]} barSize={16} />
                  <Bar dataKey="despesas" fill="#EF4444" radius={[4,4,0,0]} barSize={16} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* Saldo líquido + Saúde */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader title="Saldo do mês × acumulado" />
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize:10, fill:axisColor }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize:10, fill:axisColor }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                    <Tooltip content={<CustomTooltip />} />
                    <Line type="monotone" dataKey="líquido" stroke="#2563EB" strokeWidth={2.5} dot={{ r:3, fill:'#2563EB' }} />
                    <Line type="monotone" dataKey="acumulado" stroke="#16A34A" strokeWidth={2.5} dot={{ r:3, fill:'#16A34A' }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {healthData.length > 1 ? (
              <Card>
                <CardHeader title="Saúde Financeira" />
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={healthData} margin={{ left: -20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize:10, fill:axisColor }} axisLine={false} tickLine={false} />
                      <YAxis domain={[0,100]} tick={{ fontSize:10, fill:axisColor }} axisLine={false} tickLine={false} />
                      <Tooltip formatter={(v) => `${v} pts`} />
                      <Line type="monotone" dataKey="saúde" stroke="#16A34A" strokeWidth={2.5} dot={{ r:3, fill:'#16A34A' }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            ) : (
              <Card>
                <CardHeader title="Saúde Financeira" />
                <p className="text-sm text-muted text-center py-12">Feche mais meses para ver a evolução.</p>
              </Card>
            )}
          </div>

          {/* Tabela mês a mês */}
          <Card padding={false}>
            <div className="px-5 py-4 border-b border-border dark:border-white/[0.06]">
              <h3 className="font-semibold text-slate-900 dark:text-zinc-50">Resumo Mês a Mês</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-subtle/60 dark:bg-white/[0.03]"><tr>
                  {['Mês','Receita','Despesas pagas','Dívidas','Saldo do mês','Saldo acumulado','Saúde','Status'].map(h=><th key={h} className="table-header">{h}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-border/60 dark:divide-white/[0.06]">
                  {[...months].reverse().map((m) => (
                    <tr key={`${m.month}-${m.year}`} className="hover:bg-subtle/40 dark:hover:bg-white/[0.03] transition-colors">
                      <td className="table-cell font-semibold text-slate-800 dark:text-zinc-200">{String(m.month).padStart(2,'0')}/{m.year}</td>
                      <td className="table-cell font-mono tabular-nums text-primary-dark dark:text-primary-light font-medium">{formatCurrency(m.income)}</td>
                      <td className="table-cell font-mono tabular-nums text-danger-dark dark:text-danger-light">{formatCurrency(m.paidExpenses)}</td>
                      <td className="table-cell font-mono tabular-nums text-warning-dark dark:text-warning-light">{formatCurrency(m.debtInstallments)}</td>
                      <td className={`table-cell font-mono tabular-nums font-bold ${m.netBalance >= 0 ? 'text-success-dark dark:text-success-light' : 'text-danger-dark dark:text-danger-light'}`}>{formatCurrency(m.netBalance)}</td>
                      <td className={`table-cell font-mono tabular-nums font-bold ${m.cumulativeBalance >= 0 ? 'text-success-dark dark:text-success-light' : 'text-danger-dark dark:text-danger-light'}`}>{formatCurrency(m.cumulativeBalance)}</td>
                      <td className="table-cell">
                        {m.healthScore != null
                          ? <span className={`font-mono font-bold text-base ${m.healthScore>=75?'text-success-dark dark:text-success-light':m.healthScore>=50?'text-warning-dark dark:text-warning-light':'text-danger-dark dark:text-danger-light'}`}>{m.healthScore}</span>
                          : <span className="text-muted">—</span>}
                      </td>
                      <td className="table-cell">
                        <Badge variant={m.status==='closed'?'default':'info'}>{m.status==='closed'?'Encerrado':'Aberto'}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}