import { useState, useEffect } from 'react';
import { useMonthStore } from '../store/monthStore';
import { goalsApi } from '../lib/services';
import { extractErrorMessage } from '../lib/api';
import { formatCurrency } from '../lib/format';
import { localDateInputValue, apiDateToInput } from '../lib/date';
import { Card, Badge, Button, EmptyState, ProgressBar } from '../components/ui/index';
import { Modal, FormGroup, Input } from '../components/ui/Modal';
import { useUIStore } from '../store/uiStore';
import { useThemeStore } from '../store/themeStore';
import { ToggleSwitch, AnimatedNumber } from '../components/ui/Motion';

const SCORE_COLOR = (pct) => pct >= 75 ? '#16A34A' : pct >= 40 ? '#F59E0B' : '#3B82F6';

// Definido no nível do módulo (não dentro de GoalsPage) pelo mesmo motivo
// explicado em WhatIfSimulatorPage.jsx: uma função-componente recriada a
// cada render do pai perde a identidade estável que o React usa para
// decidir "atualizar" em vez de "desmontar e remontar". Aqui não há campo
// de texto dentro do card (então o sintoma não é perda de foco), mas o
// card inteiro remontava a cada render de GoalsPage — perdendo, por
// exemplo, qualquer transição/animação em andamento.
function GoalCard({ goal, theme, onContribute, onEdit, onCancel }) {
  const pct = Math.min(Math.round(goal.percentage), 100);
  return (
    <Card className="goal-card-v2 animate-fade-in overflow-hidden" hover>
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1 min-w-0 mr-3">
          <p className="font-bold text-slate-900 dark:text-zinc-50 text-base">{goal.name}</p>
          {goal.description && <p className="text-xs text-muted mt-0.5">{goal.description}</p>}
        </div>
        <Badge variant={goal.status==='active'?'info':goal.status==='completed'?'success':'default'}>
          {goal.status==='active'?'Ativa':goal.status==='completed'?'Concluída':'Cancelada'}
        </Badge>
      </div>

      {/* Progress ring + bar */}
      <div className="flex items-center gap-4 mb-4">
        <div className="relative h-16 w-16 shrink-0">
          <svg viewBox="0 0 36 36" className="goal-progress-ring h-16 w-16 -rotate-90">
            <circle cx="18" cy="18" r="15.9" fill="none" stroke={theme === 'dark' ? '#27272A' : '#F1F5F9'} strokeWidth="3" />
            <circle cx="18" cy="18" r="15.9" fill="none" stroke={SCORE_COLOR(pct)} strokeWidth="3"
              strokeDasharray={`${pct} ${100-pct}`} strokeLinecap="round"
              style={{ transition: 'stroke-dasharray 0.6s ease' }} />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-sm font-bold" style={{ color: SCORE_COLOR(pct) }}>{pct}%</span>
          </div>
        </div>
        <div className="flex-1">
          <div className="flex justify-between text-xs text-muted mb-1">
            <span>Acumulado</span><span>Meta</span>
          </div>
          <ProgressBar value={goal.progress} max={Number(goal.targetValue)} height="h-3"
            color={pct >= 75 ? 'success' : pct >= 40 ? 'warning' : 'info'} />
          <div className="flex justify-between mt-1">
            <span className="text-sm font-bold text-success-dark dark:text-success-light"><AnimatedNumber value={goal.progress} formatter={formatCurrency} /></span>
            <span className="text-sm font-bold text-slate-700 dark:text-zinc-300">{formatCurrency(goal.targetValue)}</span>
          </div>
        </div>
      </div>

      {goal.remaining > 0 && goal.status === 'active' && (
        <div className="rounded-xl border border-slate-200/80 bg-slate-50 p-3 mb-4 text-xs dark:border-white/[0.06] dark:bg-white/[0.025]">
          <span className="text-muted">Faltam </span>
          <span className="font-bold text-slate-800 dark:text-zinc-200">{formatCurrency(goal.remaining)}</span>
          {goal.estimatedMonthsAtCurrentPace && (
            <span className="text-muted"> · ao ritmo atual: ~<span className="font-semibold text-slate-700 dark:text-zinc-300">{goal.estimatedMonthsAtCurrentPace} meses</span></span>
          )}
        </div>
      )}

      {goal.status === 'active' && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onContribute(goal)} className="flex-1 justify-center">
            + Aportar
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onEdit(goal)}>
            Editar
          </Button>
          <Button size="sm" variant="ghost" className="text-danger" onClick={() => onCancel(goal)}>
            Cancelar
          </Button>
        </div>
      )}
    </Card>
  );
}

export default function GoalsPage() {
  const selectedMonthId = useMonthStore((s) => s.selectedMonthId);
  const [goals, setGoals]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [goalModal, setGoalModal]       = useState(false);
  const [editGoalModal, setEditGoalModal] = useState(null);
  const [contribTarget, setContribTarget] = useState(null);
  const [cancelTarget, setCancelTarget]   = useState(null);
  const [saving, setSaving]       = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [goalForm, setGoalForm]   = useState({ name:'', description:'', targetValue:'', targetDate:'' });
  const [editGoalForm, setEditGoalForm] = useState({ name:'', description:'', targetValue:'', targetDate:'' });
  const [contribForm, setContribForm] = useState({ value:'', date: localDateInputValue() });
  const [refundContributions, setRefundContributions] = useState(false);
  const toast = useUIStore((s) => s);

  const load = async () => {
    setLoading(true);
    try { const r = await goalsApi.list(); setGoals(r.data.goals ?? []); }
    catch { toast.error('Erro ao carregar metas.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  async function saveGoal() {
    if (!goalForm.name || !goalForm.targetValue) { toast.error('Preencha nome e valor alvo.'); return; }
    setSaving(true);
    try {
      await goalsApi.create({ ...goalForm, targetValue: parseFloat(goalForm.targetValue), targetDate: goalForm.targetDate || undefined });
      toast.success('Meta criada!'); setGoalModal(false); setGoalForm({ name:'', description:'', targetValue:'', targetDate:'' }); load();
    } catch (e) { toast.error(extractErrorMessage(e, 'Erro.')); }
    finally { setSaving(false); }
  }

  function openEditGoal(goal) {
    setEditGoalForm({
      name: goal.name,
      description: goal.description ?? '',
      targetValue: String(goal.targetValue),
      targetDate: goal.targetDate ? apiDateToInput(goal.targetDate) : '',
    });
    setEditGoalModal(goal);
  }

  async function saveEditGoal() {
    if (!editGoalForm.name || !editGoalForm.targetValue) { toast.error('Preencha nome e valor alvo.'); return; }
    setSaving(true);
    try {
      await goalsApi.update(editGoalModal.id, {
        name: editGoalForm.name,
        description: editGoalForm.description || undefined,
        targetValue: parseFloat(editGoalForm.targetValue),
        targetDate: editGoalForm.targetDate || undefined,
      });
      toast.success('Meta atualizada!'); setEditGoalModal(null); load();
    } catch (e) { toast.error(extractErrorMessage(e, 'Erro ao atualizar meta.')); }
    finally { setSaving(false); }
  }

  async function saveContrib() {
    if (!contribForm.value || !selectedMonthId) { toast.error('Informe um valor.'); return; }
    setSaving(true);
    try {
      await goalsApi.contribute(contribTarget.id, { value: parseFloat(contribForm.value), date: contribForm.date, monthId: selectedMonthId });
      toast.success('Aporte registrado!'); setContribTarget(null); load();
    } catch (e) { toast.error(extractErrorMessage(e, 'Erro.')); }
    finally { setSaving(false); }
  }

  async function handleCancel() {
    setCancelling(true);
    try {
      await goalsApi.cancel(cancelTarget.id, { refundContributions, monthId: selectedMonthId });
      toast.success('Meta cancelada.'); setCancelTarget(null); load();
    } catch (e) { toast.error(extractErrorMessage(e, 'Erro.')); }
    finally { setCancelling(false); }
  }

  const active    = goals.filter((g) => g.status === 'active');
  const completed = goals.filter((g) => g.status === 'completed');
  const cancelled = goals.filter((g) => g.status === 'cancelled');
  const theme = useThemeStore((s) => s.theme);

  function openContribute(goal) {
    setContribTarget(goal);
    setContribForm({ value: '', date: localDateInputValue() });
  }

  function openCancel(goal) {
    setCancelTarget(goal);
    setRefundContributions(false);
  }

  return (
    <div data-tutorial-page-ready={!loading ? 'goals' : undefined} className="space-y-6 animate-page-enter">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-[-0.025em] text-slate-950 dark:text-white">Metas Financeiras</h2>
          <p className="text-sm text-muted mt-0.5">{active.length} meta(s) ativa(s)</p>
        </div>
        <Button data-tutorial="new-goal-button" onClick={() => setGoalModal(true)}>+ Nova Meta</Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({length:2}).map((_,i) => <div key={i} className="h-56 shimmer-bg rounded-2xl" />)}
        </div>
      ) : goals.length === 0 ? (
        <Card><EmptyState icon="🎯" title="Nenhuma meta criada" description="Defina objetivos financeiros e acompanhe seu progresso."
          action={<Button onClick={() => setGoalModal(true)}>Criar primeira meta</Button>} /></Card>
      ) : (
        <div className="space-y-6">
          {active.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-slate-600 dark:text-zinc-400 mb-3">Ativas ({active.length})</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{active.map((g) => (
                <GoalCard key={g.id} goal={g} theme={theme} onContribute={openContribute} onEdit={openEditGoal} onCancel={openCancel} />
              ))}</div>
            </div>
          )}
          {completed.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-slate-600 dark:text-zinc-400 mb-3">Concluídas ({completed.length})</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{completed.map((g) => (
                <GoalCard key={g.id} goal={g} theme={theme} onContribute={openContribute} onEdit={openEditGoal} onCancel={openCancel} />
              ))}</div>
            </div>
          )}
          {cancelled.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-muted mb-3">Canceladas ({cancelled.length})</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{cancelled.map((g) => (
                <GoalCard key={g.id} goal={g} theme={theme} onContribute={openContribute} onEdit={openEditGoal} onCancel={openCancel} />
              ))}</div>
            </div>
          )}
        </div>
      )}

      {/* Modal Nova Meta */}
      <Modal open={goalModal} onClose={() => setGoalModal(false)} title="Nova Meta">
        <div className="space-y-4">
          <FormGroup label="Nome" required><Input value={goalForm.name} onChange={(e) => setGoalForm({...goalForm,name:e.target.value})} placeholder="Ex: Tênis novo, Viagem..." autoFocus /></FormGroup>
          <FormGroup label="Descrição"><Input value={goalForm.description} onChange={(e) => setGoalForm({...goalForm,description:e.target.value})} placeholder="Opcional" /></FormGroup>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormGroup label="Valor alvo" required><Input type="number" min="0" step="0.01" value={goalForm.targetValue} onChange={(e) => setGoalForm({...goalForm,targetValue:e.target.value})} /></FormGroup>
            <FormGroup label="Data desejada" hint="opcional"><Input type="date" value={goalForm.targetDate} onChange={(e) => setGoalForm({...goalForm,targetDate:e.target.value})} /></FormGroup>
          </div>
          <div className="flex flex-wrap gap-3 justify-end pt-2">
            <Button variant="outline" onClick={() => setGoalModal(false)}>Cancelar</Button>
            <Button onClick={saveGoal} loading={saving}>Criar Meta</Button>
          </div>
        </div>
      </Modal>

      {/* Modal Editar Meta */}
      <Modal open={!!editGoalModal} onClose={() => setEditGoalModal(null)} title="Editar Meta">
        <div className="space-y-4">
          <FormGroup label="Nome" required><Input value={editGoalForm.name} onChange={(e) => setEditGoalForm({...editGoalForm,name:e.target.value})} autoFocus /></FormGroup>
          <FormGroup label="Descrição"><Input value={editGoalForm.description} onChange={(e) => setEditGoalForm({...editGoalForm,description:e.target.value})} placeholder="Opcional" /></FormGroup>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormGroup label="Valor alvo" required hint="o progresso acumulado não é alterado"><Input type="number" min="0" step="0.01" value={editGoalForm.targetValue} onChange={(e) => setEditGoalForm({...editGoalForm,targetValue:e.target.value})} /></FormGroup>
            <FormGroup label="Data desejada" hint="opcional"><Input type="date" value={editGoalForm.targetDate} onChange={(e) => setEditGoalForm({...editGoalForm,targetDate:e.target.value})} /></FormGroup>
          </div>
          <div className="flex flex-wrap gap-3 justify-end pt-2">
            <Button variant="outline" onClick={() => setEditGoalModal(null)}>Cancelar</Button>
            <Button onClick={saveEditGoal} loading={saving}>Salvar Alterações</Button>
          </div>
        </div>
      </Modal>

      {/* Modal Aporte */}
      <Modal open={!!contribTarget} onClose={() => setContribTarget(null)} title={`Aportar em "${contribTarget?.name}"`} size="sm">
        <div className="space-y-4">
          <div className="bg-primary-subtle border border-primary/20 rounded-xl p-3 text-sm">
            <span className="text-primary-dark">Faltam </span>
            <span className="font-bold text-primary-dark">{formatCurrency(contribTarget?.remaining ?? 0)}</span>
            <span className="text-primary-dark"> para atingir a meta</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormGroup label="Valor" required><Input type="number" min="0" step="0.01" value={contribForm.value} onChange={(e) => setContribForm({...contribForm,value:e.target.value})} autoFocus /></FormGroup>
            <FormGroup label="Data"><Input type="date" value={contribForm.date} onChange={(e) => setContribForm({...contribForm,date:e.target.value})} /></FormGroup>
          </div>
          <p className="text-xs text-muted bg-subtle dark:bg-white/[0.04] p-3 rounded-xl">O valor será descontado do saldo atual do mês selecionado no sistema.</p>
          <div className="flex flex-wrap gap-3 justify-end">
            <Button variant="outline" onClick={() => setContribTarget(null)}>Cancelar</Button>
            <Button onClick={saveContrib} loading={saving}>Confirmar Aporte</Button>
          </div>
        </div>
      </Modal>

      {/* Modal Cancelar */}
      <Modal open={!!cancelTarget} onClose={() => setCancelTarget(null)} title={`Cancelar "${cancelTarget?.name}"`} size="sm">
        <div className="space-y-4">
          <p className="text-sm text-muted">A meta será arquivada. Esta ação não pode ser desfeita.</p>
          <ToggleSwitch checked={refundContributions} onChange={setRefundContributions} label="Devolver aportes ao saldo" description={`${formatCurrency(cancelTarget?.progress ?? 0)} serão devolvidos ao mês atual.`} />
          <div className="flex flex-wrap gap-3 justify-end">
            <Button variant="outline" onClick={() => setCancelTarget(null)}>Voltar</Button>
            <Button variant="danger" onClick={handleCancel} loading={cancelling}>Cancelar Meta</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}