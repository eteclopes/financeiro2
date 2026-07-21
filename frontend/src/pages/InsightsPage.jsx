import { useState, useEffect, useCallback } from 'react';
import { useMonthStore } from '../store/monthStore';
import { alertsApi, recommendationsApi } from '../lib/services';
import { formatShortDate } from '../lib/format';
import { Card, CardHeader, Badge, EmptyState, Skeleton, TabGroup } from '../components/ui/index';
import { useUIStore } from '../store/uiStore';

const SEVERITY_META = {
  critical: { emoji: '🔴', className: 'bg-danger-subtle dark:bg-danger/10 border-danger/20' },
  warning:  { emoji: '🟡', className: 'bg-warning-subtle dark:bg-warning/10 border-warning/20' },
  info:     { emoji: '🔵', className: 'bg-info-subtle dark:bg-info/10 border-info/20' },
};

const PRIORITY_VARIANT = { high: 'danger', medium: 'warning', low: 'default' };
const PRIORITY_LABEL = { high: 'Alta prioridade', medium: 'Média prioridade', low: 'Baixa prioridade' };

const TABS = [
  { value: 'active',   label: 'Alertas ativos' },
  { value: 'resolved',  label: 'Histórico' },
];

export default function InsightsPage() {
  const selectedMonthId = useMonthStore((s) => s.selectedMonthId);
  const [alerts, setAlerts]                 = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading]               = useState(true);
  const [tab, setTab]                       = useState('active');
  const toast = useUIStore((s) => s);

  const load = useCallback(async () => {
    if (!selectedMonthId) return;
    setLoading(true);
    try {
      const [alertsRes, recRes] = await Promise.all([
        alertsApi.list(selectedMonthId),
        recommendationsApi.get(selectedMonthId),
      ]);
      setAlerts(alertsRes.data.alerts ?? []);
      setRecommendations(recRes.data.recommendations ?? []);
    } catch { toast.error('Erro ao carregar alertas e recomendações.'); }
    finally { setLoading(false); }
  }, [selectedMonthId]);

  useEffect(() => { load(); }, [load]);

  const activeAlerts   = alerts.filter((a) => !a.resolvedAt);
  const resolvedAlerts = alerts.filter((a) => a.resolvedAt);
  const visibleAlerts  = tab === 'active' ? activeAlerts : resolvedAlerts;

  if (loading) return (
    <div className="space-y-4 animate-pulse">
      <Skeleton className="h-8 w-56" />
      {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
    </div>
  );

  return (
    <div className="space-y-6 animate-page-enter">
      <div>
        <h2 className="text-2xl font-bold tracking-[-0.025em] text-slate-950 dark:text-white">Central de Alertas e Recomendações</h2>
        <p className="text-sm text-muted mt-0.5">Tudo que o sistema detectou sobre o mês selecionado, em um só lugar</p>
      </div>

      <Card>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
          <CardHeader title="Alertas" subtitle={`${activeAlerts.length} ativo(s) · ${resolvedAlerts.length} resolvido(s)`} className="!mb-0" />
          <TabGroup tabs={TABS} value={tab} onChange={setTab} />
        </div>

        {visibleAlerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="text-3xl mb-2">{tab === 'active' ? '✓' : '—'}</div>
            <p className="text-sm font-medium text-muted">
              {tab === 'active' ? 'Nenhum alerta ativo neste mês.' : 'Nenhum alerta resolvido neste mês ainda.'}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {visibleAlerts.map((a) => {
              const meta = SEVERITY_META[a.severity] ?? SEVERITY_META.info;
              return (
                <li key={a.id} className={`flex items-start gap-2.5 p-3 rounded-xl text-sm border ${meta.className}`}>
                  <span className="mt-0.5 shrink-0">{meta.emoji}</span>
                  <div className="flex-1">
                    <p className="text-slate-700 dark:text-zinc-300 leading-relaxed">{a.message}</p>
                    {a.resolvedAt && (
                      <p className="text-xs text-muted mt-1">Resolvido em {formatShortDate(a.resolvedAt)}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Recomendações" subtitle={`${recommendations.length} no mês`} />
        {recommendations.length === 0 ? (
          <EmptyState icon="💡" title="Sem recomendações" description="Continue usando o sistema para gerar recomendações personalizadas com base no seu histórico." />
        ) : (
          <ul className="space-y-3">
            {recommendations.map((r, i) => (
              <li key={i} className="p-4 rounded-xl bg-primary-subtle dark:bg-primary/10 border border-primary/20">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="font-semibold text-primary-dark dark:text-primary-light">{r.title}</p>
                  <Badge variant={PRIORITY_VARIANT[r.priority] ?? 'default'}>{PRIORITY_LABEL[r.priority] ?? r.priority}</Badge>
                </div>
                <p className="text-sm text-slate-600 dark:text-zinc-400 leading-relaxed mb-2">{r.description}</p>
                {r.calculation && (
                  <p className="text-xs text-muted font-mono bg-white/50 dark:bg-black/20 rounded-lg px-2.5 py-1.5">
                    {r.calculation}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
