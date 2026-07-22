import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { planningApi } from '../lib/services';
import { extractErrorMessage } from '../lib/api';
import { formatCurrency, formatShortDate } from '../lib/format';
import { useMonthStore } from '../store/monthStore';
import { useUIStore } from '../store/uiStore';
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, ProgressBar, Skeleton } from '../components/ui/index';
import { IconAlert, IconCard, IconGoal, IconReport, IconTrend } from '../components/icons';

const ALERT_TONES = {
  critical: 'danger',
  warning: 'warning',
  info: 'info',
};

const GOAL_STATUS = {
  completed: { label: 'Concluída', tone: 'success' },
  on_track: { label: 'No ritmo', tone: 'success' },
  behind: { label: 'Abaixo do ritmo', tone: 'warning' },
};

function LoadingState() {
  return (
    <div className="space-y-6 animate-page-enter">
      <Skeleton className="h-20" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-28" />)}
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}

function Metric({ label, value, helper, icon }) {
  return (
    <Card className="min-h-[126px]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.13em] text-slate-400 dark:text-zinc-500">{label}</p>
          <p className="mt-3 text-2xl font-extrabold tracking-tight text-slate-950 dark:text-white">{value}</p>
          {helper && <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-zinc-400">{helper}</p>}
        </div>
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-subtle text-primary dark:bg-primary/10 dark:text-primary-hover">{icon}</div>
      </div>
    </Card>
  );
}

function CardPlan({ card }) {
  const usage = Math.min(Math.max(Number(card.usagePercentage ?? 0), 0), 100);
  const tone = usage >= 95 ? 'danger' : usage >= 80 ? 'warning' : 'primary';
  return (
    <div className="rounded-2xl border border-slate-200/80 p-4 dark:border-white/[0.07]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{card.name}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">Melhor dia estimado: até {formatShortDate(card.closingDate)}</p>
        </div>
        <Badge variant={usage >= 95 ? 'danger' : usage >= 80 ? 'warning' : 'success'}>{Math.round(usage)}% usado</Badge>
      </div>
      <div className="mt-4"><ProgressBar value={usage} color={tone} /></div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
        <div><p className="text-slate-400 dark:text-zinc-500">Disponível</p><p className="mt-0.5 font-bold text-slate-800 dark:text-zinc-200">{formatCurrency(card.availableLimit)}</p></div>
        <div><p className="text-slate-400 dark:text-zinc-500">Próximo vencimento</p><p className="mt-0.5 font-bold text-slate-800 dark:text-zinc-200">{formatShortDate(card.dueDate)}</p></div>
      </div>
    </div>
  );
}

export default function PlanningPage() {
  const selectedMonthId = useMonthStore((state) => state.selectedMonthId);
  const getSelectedMonth = useMonthStore((state) => state.getSelectedMonth);
  const errorToast = useUIStore((state) => state.error);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!selectedMonthId) return;
    const requestedMonthId = selectedMonthId;
    setLoading(true);
    setError(null);
    try {
      const response = await planningApi.get(requestedMonthId);
      if (String(useMonthStore.getState().selectedMonthId) !== String(requestedMonthId)) return;
      setData(response.data);
    } catch (requestError) {
      if (String(useMonthStore.getState().selectedMonthId) !== String(requestedMonthId)) return;
      const message = extractErrorMessage(requestError, 'Não foi possível carregar o planejamento Pro.');
      setError(message);
      errorToast(message);
    } finally {
      if (String(useMonthStore.getState().selectedMonthId) === String(requestedMonthId)) setLoading(false);
    }
  }, [selectedMonthId, errorToast]);

  useEffect(() => { load(); }, [load]);

  const month = getSelectedMonth();
  const goalsBehind = useMemo(() => data?.goalPlans?.filter((goal) => goal.status === 'behind').length ?? 0, [data]);
  const nextInvoices = useMemo(
    () => data?.cards?.invoiceForecast?.reduce((sum, period) => sum + Number(period.total ?? 0), 0) ?? 0,
    [data]
  );

  if (loading || !selectedMonthId) return <LoadingState />;

  if (error || !data) {
    return (
      <Card>
        <EmptyState
          icon={<IconAlert size={24} />}
          title="Planejamento indisponível"
          description={error || 'Não encontramos dados suficientes para montar o planejamento.'}
          action={<Button onClick={load}>Tentar novamente</Button>}
        />
      </Card>
    );
  }

  const { debtPlan, goalPlans, cards, smartAlerts } = data;

  return (
    <div className="space-y-6 animate-page-enter">
      <PageHeader
        eyebrow="Pro"
        title="Central de planejamento"
        description={`Decisões orientadas pelos seus dados de ${month ? `${String(month.month).padStart(2, '0')}/${month.year}` : 'finanças'}. Nenhuma sugestão altera lançamentos automaticamente.`}
        actions={<Button variant="outline" onClick={load}>Atualizar análise</Button>}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Dívidas ativas" value={debtPlan.activeCount} helper={`${formatCurrency(debtPlan.totalRemaining)} ainda em aberto`} icon={<IconReport size={19} />} />
        <Metric label="Parcelas mensais" value={formatCurrency(debtPlan.monthlyCommitment)} helper="Compromisso estimado das dívidas ativas" icon={<IconTrend size={19} />} />
        <Metric label="Próximas faturas" value={formatCurrency(nextInvoices)} helper="Soma dos períodos futuros encontrados" icon={<IconCard size={19} />} />
        <Metric label="Metas pedindo atenção" value={goalsBehind} helper={`${goalPlans.length} meta(s) ativa(s) analisada(s)`} icon={<IconGoal size={19} />} />
      </div>

      <Card>
        <CardHeader title="Alertas inteligentes" subtitle="Sinais objetivos encontrados nos seus cartões, dívidas e metas." />
        {smartAlerts.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {smartAlerts.map((alert, index) => (
              <div key={`${alert.type}-${index}`} className="flex gap-3 rounded-2xl border border-slate-200/80 p-4 dark:border-white/[0.07]">
                <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary-subtle text-primary dark:bg-primary/10 dark:text-primary-hover"><IconAlert size={17} /></div>
                <div><Badge variant={ALERT_TONES[alert.severity] ?? 'info'}>{alert.severity === 'critical' ? 'Crítico' : alert.severity === 'warning' ? 'Atenção' : 'Informação'}</Badge><p className="mt-2 text-sm leading-relaxed text-slate-700 dark:text-zinc-300">{alert.message}</p></div>
              </div>
            ))}
          </div>
        ) : <EmptyState icon="✓" title="Nenhum alerta relevante" description="Os indicadores analisados não ultrapassaram os limites de atenção neste momento." />}
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Estratégia dos cartões" subtitle="Uso do limite, janela de compra e próximas faturas." actions={<Link to="/cards"><Button variant="ghost" size="sm">Ver cartões</Button></Link>} />
          {cards.bestCard && (
            <div className="mb-4 rounded-2xl border border-primary/20 bg-primary-subtle/70 p-4 dark:bg-primary/[0.07]">
              <div className="flex flex-wrap items-center justify-between gap-2"><Badge variant="purple">Melhor janela estimada</Badge><span className="text-xs font-bold text-primary-dark dark:text-primary-hover">{cards.bestCard.daysUntilDue} dias até o vencimento</span></div>
              <p className="mt-2 text-base font-bold text-slate-950 dark:text-white">{cards.bestCard.name}</p>
              <p className="mt-1 text-sm text-slate-600 dark:text-zinc-400">Disponível: {formatCurrency(cards.bestCard.availableLimit)} · vencimento estimado em {formatShortDate(cards.bestCard.dueDate)}</p>
            </div>
          )}
          {cards.plans.length ? <div className="space-y-3">{cards.plans.map((card) => <CardPlan key={card.id} card={card} />)}</div> : <EmptyState icon={<IconCard size={24} />} title="Nenhum cartão ativo" description="Cadastre um cartão para receber análises de limite e melhor janela de compra." />}
        </Card>

        <Card>
          <CardHeader title="Previsão de faturas" subtitle="Valores ainda não pagos agrupados pelos próximos períodos." />
          {cards.overdueInvoices?.length > 0 && (
            <div className="mb-4 rounded-2xl border border-danger/20 bg-danger-subtle p-4 dark:bg-danger/10">
              <div className="flex items-center justify-between gap-3"><p className="text-sm font-bold text-danger-dark dark:text-danger-light">Faturas vencidas em aberto</p><Badge variant="danger">{cards.overdueInvoices.length}</Badge></div>
              <p className="mt-1 text-xs text-danger-dark/80 dark:text-danger-light/80">Total pendente: {formatCurrency(cards.overdueInvoices.reduce((sum, invoice) => sum + Number(invoice.total ?? 0), 0))}</p>
            </div>
          )}
          {cards.invoiceForecast.length ? (
            <div className="space-y-3">
              {cards.invoiceForecast.map((period) => (
                <div key={`${period.year}-${period.month}`} className="rounded-2xl border border-slate-200/80 p-4 dark:border-white/[0.07]">
                  <div className="flex items-center justify-between gap-3"><p className="text-sm font-bold capitalize text-slate-900 dark:text-white">{String(period.month).padStart(2, '0')}/{period.year}</p><p className="font-extrabold text-slate-950 dark:text-white">{formatCurrency(period.total)}</p></div>
                  <div className="mt-3 space-y-2">{period.invoices.map((invoice) => <div key={invoice.id} className="flex items-center justify-between gap-3 text-xs"><span className="truncate text-slate-500 dark:text-zinc-400">{invoice.cardName} · vence {formatShortDate(invoice.dueDate)}</span><span className="shrink-0 font-bold text-slate-700 dark:text-zinc-200">{formatCurrency(invoice.total)}</span></div>)}</div>
                </div>
              ))}
            </div>
          ) : <EmptyState icon={<IconCard size={24} />} title="Sem faturas futuras" description="As próximas compras parceladas e despesas no cartão aparecerão aqui." />}
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Plano de quitação — bola de neve" subtitle="Prioriza o menor saldo para gerar vitórias rápidas. Juros não são inferidos quando não estão cadastrados." actions={<Link to="/calculators"><Button variant="ghost" size="sm">Simular dívida</Button></Link>} />
          {debtPlan.snowballOrder.length ? (
            <div className="space-y-3">
              {debtPlan.snowballOrder.map((debt, index) => (
                <div key={debt.id} className="flex items-center gap-3 rounded-2xl border border-slate-200/80 p-4 dark:border-white/[0.07]">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary-subtle text-sm font-black text-primary dark:bg-primary/10 dark:text-primary-hover">{index + 1}</div>
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-900 dark:text-white">{debt.description}</p><p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">Parcela {formatCurrency(debt.installmentValue)}{debt.estimatedInstallments ? ` · aproximadamente ${debt.estimatedInstallments} parcela(s)` : ''}</p></div>
                  <p className="shrink-0 text-sm font-extrabold text-slate-950 dark:text-white">{formatCurrency(debt.remainingBalance)}</p>
                </div>
              ))}
            </div>
          ) : <EmptyState icon={<IconReport size={24} />} title="Nenhuma dívida ativa" description="Quando houver dívidas, a ordem sugerida aparecerá aqui sem alterar seus registros." />}
        </Card>

        <Card>
          <CardHeader title="Ritmo das metas" subtitle="Compara o aporte recente com o necessário para alcançar cada prazo." actions={<Link to="/goals"><Button variant="ghost" size="sm">Ver metas</Button></Link>} />
          {goalPlans.length ? (
            <div className="space-y-4">
              {goalPlans.map((goal) => {
                const status = GOAL_STATUS[goal.status] ?? GOAL_STATUS.on_track;
                return (
                  <div key={goal.id} className="rounded-2xl border border-slate-200/80 p-4 dark:border-white/[0.07]">
                    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-900 dark:text-white">{goal.name}</p><p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">{formatCurrency(goal.progress)} de {formatCurrency(goal.targetValue)}</p></div><Badge variant={status.tone}>{status.label}</Badge></div>
                    <div className="mt-3"><ProgressBar value={goal.percentage} color={goal.status === 'behind' ? 'warning' : 'success'} /></div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 text-xs"><div><p className="text-slate-400 dark:text-zinc-500">Aporte recomendado</p><p className="mt-0.5 font-bold text-slate-800 dark:text-zinc-200">{goal.recommendedMonthly == null ? 'Defina uma data' : `${formatCurrency(goal.recommendedMonthly)}/mês`}</p></div><div><p className="text-slate-400 dark:text-zinc-500">Ritmo recente</p><p className="mt-0.5 font-bold text-slate-800 dark:text-zinc-200">{formatCurrency(goal.currentMonthlyPace)}/mês</p></div></div>
                  </div>
                );
              })}
            </div>
          ) : <EmptyState icon={<IconGoal size={24} />} title="Nenhuma meta ativa" description="Crie uma meta com valor e prazo para receber uma sugestão mensal de aporte." />}
        </Card>
      </div>

      <div className="rounded-2xl border border-info/20 bg-info-subtle p-4 text-xs leading-relaxed text-info-dark dark:bg-info/10 dark:text-info-light">
        As recomendações são estimativas de planejamento baseadas nos dados cadastrados. Elas não constituem aconselhamento financeiro e nunca criam, pagam ou movem lançamentos automaticamente.
      </div>
    </div>
  );
}
