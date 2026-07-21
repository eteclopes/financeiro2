import { useState, useEffect, useCallback } from 'react';
import { useMonthStore } from '../store/monthStore';
import { dashboardApi } from '../lib/services';
import { formatCurrency, formatMonthLabel } from '../lib/format';
import { Card, CardHeader, Badge, Button, ProgressBar } from '../components/ui/index';
import { useUIStore } from '../store/uiStore';
import { useThemeStore } from '../store/themeStore';

export default function ReportsPage() {
  const selectedMonthId = useMonthStore((s) => s.selectedMonthId);
  const getSelected     = useMonthStore((s) => s.getSelectedMonth);
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const toast = useUIStore((s) => s);
  const theme = useThemeStore((s) => s.theme);

  const load = useCallback(async () => {
    if (!selectedMonthId) return;
    setLoading(true);
    try { const r = await dashboardApi.get(selectedMonthId); setData(r.data); }
    catch { toast.error('Erro ao carregar relatório.'); }
    finally { setLoading(false); }
  }, [selectedMonthId]);

  useEffect(() => { load(); }, [load]);

  const month = getSelected();

  if (loading) return (
    <div className="space-y-4 animate-pulse">
      {Array.from({length:4}).map((_,i) => <div key={i} className="h-48 shimmer-bg rounded-2xl" />)}
    </div>
  );
  if (!data) return null;

  const health = data.financialHealthScore;
  const activeAlerts = (data.alerts ?? []).filter((a) => !a.resolvedAt);

  const SCORE_COLOR = (s) => s >= 75 ? '#16A34A' : s >= 50 ? '#F59E0B' : '#EF4444';

  return (
    <div data-tutorial-page-ready="reports" className="space-y-6 animate-page-enter" id="report-content">
      <div className="flex items-center justify-between flex-wrap gap-3 print:hidden">
        <div>
          <h2 className="text-2xl font-bold tracking-[-0.025em] text-slate-950 dark:text-white print:text-slate-900">Relatórios</h2>
          <p className="text-sm text-muted mt-0.5">{month ? formatMonthLabel(month) : ''}</p>
        </div>
        <Button onClick={() => window.print()} variant="outline">Exportar PDF</Button>
      </div>

      {/* ── Relatório Mensal ── */}
      <Card>
        <CardHeader title="Resumo Financeiro Mensal" subtitle={month ? formatMonthLabel(month) : ''} />
        <div className="auto-grid-comfortable">
          {[
            { label:'Receita Total',      value: data.incomeTotal,      color:'text-primary-dark dark:text-primary-light' },
            { label:'Despesas Previstas', value: data.expensesPlanned,  color:'text-danger-dark dark:text-danger-light'  },
            { label:'Despesas Pagas',     value: data.expensesPaid,     color:'text-danger-dark dark:text-danger-light'  },
            { label:'Saldo Atual',        value: data.currentBalance,   color: data.currentBalance   >= 0 ? 'text-success-dark dark:text-success-light' : 'text-danger-dark dark:text-danger-light' },
            { label:'Saldo Projetado',    value: data.projectedBalance, color: data.projectedBalance >= 0 ? 'text-success-dark dark:text-success-light' : 'text-danger-dark dark:text-danger-light' },
            { label:'Dívida Ativa Total', value: data.totalActiveDebt,  color:'text-warning-dark dark:text-warning-light' },
          ].map((item) => (
            <div key={item.label} className="bg-subtle dark:bg-white/[0.04] rounded-2xl p-4">
              <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">{item.label}</p>
              <p className={`text-xl font-bold font-mono tabular-nums ${item.color}`}>{formatCurrency(item.value)}</p>
            </div>
          ))}
        </div>

        {/* Comprometimento de renda */}
        {data.commitment && (
          <div className="mt-4 pt-4 border-t border-border dark:border-white/[0.06]">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-slate-700 dark:text-zinc-300">Comprometimento da Renda</p>
              <Badge variant={data.commitment.band === 'saudavel' ? 'success' : data.commitment.band === 'critico' ? 'danger' : 'warning'}>
                {data.commitment.label} — {Math.round(data.commitment.ratio * 100)}%
              </Badge>
            </div>
            <ProgressBar value={data.commitment.ratio * 100} max={100} height="h-2.5"
              color={data.commitment.band === 'saudavel' ? 'primary' : data.commitment.band === 'critico' ? 'danger' : 'warning'} />
          </div>
        )}
      </Card>

      {/* ── Saúde Financeira ── */}
      {health && (
        <Card>
          <CardHeader title="Relatório de Saúde Financeira" />
          <div className="flex items-center gap-5 mb-5">
            <div className="relative h-24 w-24 shrink-0">
              <svg viewBox="0 0 36 36" className="h-24 w-24 -rotate-90">
                <circle cx="18" cy="18" r="15.9" fill="none" stroke={theme === 'dark' ? '#27272A' : '#F1F5F9'} strokeWidth="3" />
                <circle cx="18" cy="18" r="15.9" fill="none" stroke={SCORE_COLOR(health.score)} strokeWidth="3"
                  strokeDasharray={`${health.score} ${100 - health.score}`} strokeLinecap="round" />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-2xl font-bold" style={{ color: SCORE_COLOR(health.score) }}>{health.score}</span>
              </div>
            </div>
            <div>
              <p className="text-3xl font-bold text-slate-900 dark:text-zinc-50">{health.score} <span className="text-base text-muted font-normal">/ 100 pontos</span></p>
              <Badge variant={health.score >= 75 ? 'success' : health.score >= 50 ? 'warning' : 'danger'} className="mt-1 text-sm px-3 py-1">
                {health.score >= 75 ? 'Saúde Boa' : health.score >= 50 ? 'Saúde Regular' : 'Saúde Crítica'}
              </Badge>
            </div>
          </div>
          {health.breakdown && (
            <div className="space-y-3">
              {Object.entries(health.breakdown).map(([key, f]) => (
                <div key={key} className="flex items-center gap-3 p-3 bg-subtle dark:bg-white/[0.04] rounded-xl">
                  <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: f.points >= f.max * 0.6 ? '#16A34A' : f.points > 0 ? '#F59E0B' : '#EF4444' }} />
                  <p className="text-sm text-slate-700 dark:text-zinc-300 flex-1">{f.reason}</p>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="w-20 bg-border dark:bg-white/10 h-1.5 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${(f.points/f.max)*100}%`, backgroundColor: f.points >= f.max * 0.6 ? '#16A34A' : f.points > 0 ? '#F59E0B' : '#EF4444' }} />
                    </div>
                    <span className="text-sm font-mono font-bold text-slate-700 dark:text-zinc-300 w-10 text-right">{f.points}/{f.max}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ── Alertas ── */}
      {(data.alerts ?? []).length > 0 && (
        <Card>
          <CardHeader title="Alertas do Período" subtitle={`${activeAlerts.length} ativo(s)`} />
          <div className="space-y-2">
            {data.alerts.map((a) => (
              <div key={a.id} className={`flex items-start gap-3 p-3.5 rounded-xl border ${a.resolvedAt ? 'bg-subtle dark:bg-white/[0.04] border-border dark:border-white/10 opacity-60' : a.severity === 'critical' ? 'bg-danger-subtle dark:bg-danger/10 border-danger/20' : a.severity === 'warning' ? 'bg-warning-subtle dark:bg-warning/10 border-warning/20' : 'bg-info-subtle dark:bg-info/10 border-info/20'}`}>
                <span className="text-base shrink-0 mt-0.5">{a.resolvedAt ? '✓' : a.severity === 'critical' ? '🔴' : a.severity === 'warning' ? '🟡' : 'ℹ'}</span>
                <div className="flex-1">
                  <p className="text-sm text-slate-700 dark:text-zinc-300">{a.message}</p>
                  {a.resolvedAt && <p className="text-xs text-muted mt-0.5">Resolvido</p>}
                </div>
                <Badge variant={a.resolvedAt ? 'default' : a.severity === 'critical' ? 'danger' : a.severity === 'warning' ? 'warning' : 'info'}>
                  {a.resolvedAt ? 'resolvido' : a.severity}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Recomendações ── */}
      {(data.recommendations ?? []).length > 0 && (
        <Card>
          <CardHeader title="Recomendações do Período" />
          <div className="space-y-3">
            {data.recommendations.map((r, i) => (
              <div key={i} className="border border-border dark:border-white/10 rounded-2xl p-4">
                <div className="flex items-start justify-between gap-3 mb-1">
                  <p className="font-semibold text-sm text-slate-900 dark:text-zinc-50">{r.title}</p>
                  <Badge variant={r.priority === 'high' ? 'danger' : r.priority === 'medium' ? 'warning' : 'info'} className="shrink-0">
                    {r.priority === 'high' ? 'Alta' : r.priority === 'medium' ? 'Média' : 'Baixa'}
                  </Badge>
                </div>
                <p className="text-xs text-slate-600 dark:text-zinc-400 leading-relaxed">{r.description}</p>
                {r.calculation && (
                  <p className="text-xs text-muted bg-subtle dark:bg-white/[0.04] rounded-xl p-2 mt-2 font-mono">{r.calculation}</p>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Metas ── */}
      {(data.goals ?? []).length > 0 && (
        <Card padding={false}>
          <div className="px-5 py-4 border-b border-border dark:border-white/[0.06]">
            <h3 className="font-semibold text-slate-900 dark:text-zinc-50">Relatório de Metas Ativas</h3>
          </div>
          <div className="data-table-scroll">
            <table className="w-full text-sm">
              <thead className="bg-subtle/60 dark:bg-white/[0.03]"><tr>
                {['Meta','Valor Alvo','Acumulado','Progresso','Prazo estimado'].map(h => (
                  <th key={h} className="table-header">{h}</th>
                ))}
              </tr></thead>
              <tbody className="divide-y divide-border/60 dark:divide-white/[0.06]">
                {data.goals.map((g) => (
                  <tr key={g.id} className="hover:bg-subtle/40 dark:hover:bg-white/[0.03] transition-colors">
                    <td className="table-cell font-semibold text-slate-800 dark:text-zinc-200">{g.name}</td>
                    <td className="table-cell font-mono tabular-nums">{formatCurrency(g.targetValue)}</td>
                    <td className="table-cell font-mono tabular-nums text-primary-dark dark:text-primary-light font-bold">{formatCurrency(g.progress)}</td>
                    <td className="table-cell">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-subtle dark:bg-white/10 rounded-full overflow-hidden min-w-16">
                          <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min(g.percentage, 100)}%` }} />
                        </div>
                        <span className="text-xs font-mono font-bold text-slate-700 dark:text-zinc-300 shrink-0">{Math.round(g.percentage)}%</span>
                      </div>
                    </td>
                    <td className="table-cell text-muted">
                      {g.estimatedMonthsAtCurrentPace ? `~${g.estimatedMonthsAtCurrentPace} meses` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── Cartões ── */}
      {(data.cards ?? []).length > 0 && (
        <Card padding={false}>
          <div className="px-5 py-4 border-b border-border dark:border-white/[0.06]">
            <h3 className="font-semibold text-slate-900 dark:text-zinc-50">Relatório de Cartões</h3>
          </div>
          <div className="data-table-scroll">
            <table className="w-full text-sm">
              <thead className="bg-subtle/60 dark:bg-white/[0.03]"><tr>
                {['Cartão','Limite Total','Utilizado','Disponível','Utilização'].map(h => (
                  <th key={h} className="table-header">{h}</th>
                ))}
              </tr></thead>
              <tbody className="divide-y divide-border/60 dark:divide-white/[0.06]">
                {data.cards.map((c) => {
                  const pct = Math.min(Math.round((c.usedLimit / Number(c.limitValue)) * 100), 100);
                  return (
                    <tr key={c.id} className="hover:bg-subtle/40 dark:hover:bg-white/[0.03] transition-colors">
                      <td className="table-cell font-semibold text-slate-800 dark:text-zinc-200">{c.name}</td>
                      <td className="table-cell font-mono tabular-nums">{formatCurrency(c.limitValue)}</td>
                      <td className="table-cell font-mono tabular-nums text-danger-dark dark:text-danger-light">{formatCurrency(c.usedLimit)}</td>
                      <td className="table-cell font-mono tabular-nums text-primary-dark dark:text-primary-light">{formatCurrency(c.availableLimit)}</td>
                      <td className="table-cell">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-subtle dark:bg-white/10 rounded-full overflow-hidden min-w-16">
                            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: c.color ?? '#16A34A' }} />
                          </div>
                          <Badge variant={pct >= 80 ? 'danger' : pct >= 50 ? 'warning' : 'success'}>{pct}%</Badge>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}