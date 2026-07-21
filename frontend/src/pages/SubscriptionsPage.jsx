import { useState, useEffect, useCallback } from 'react';
import { useMonthStore } from '../store/monthStore';
import { subscriptionsApi, categoriesApi, cardsApi } from '../lib/services';
import { extractErrorMessage } from '../lib/api';
import { formatCurrency, formatShortDate } from '../lib/format';
import { useUIStore } from '../store/uiStore';
import { Card, Badge, Button, EmptyState, Skeleton } from '../components/ui/index';
import { Modal, FormGroup, Input, Select } from '../components/ui/Modal';
import { CategorySelect } from '../components/ui/CategorySelect';

const PM_LABELS = { cash:'Dinheiro', pix:'PIX', debit:'Débito', credit:'Cartão de Crédito', transfer:'Conta' };
const PERIODICITY_LABELS = { monthly:'Mensal', annual:'Anual', custom:'Personalizada' };
const STATUS_BADGE = { active:'success', paused:'warning', cancelled:'default', completed:'info' };
const STATUS_LABEL = { active:'Ativa', paused:'Pausada', cancelled:'Cancelada', completed:'Concluída' };

function todayISO() { return new Date().toISOString().slice(0, 10); }

// No nível do módulo, não dentro de SubscriptionsPage — evita o problema
// de perda de identidade entre renders já corrigido em GoalsPage.jsx/
// WhatIfSimulatorPage.jsx/SavingsPage.jsx nesta mesma sessão.
function SubscriptionCard({ s, onPause, onResume, onEdit, onCancel }) {
  return (
    <Card>
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="font-bold text-slate-900 dark:text-zinc-50">{s.description}</p>
          <p className="text-xs text-muted mt-0.5">{s.category?.name ?? '—'}</p>
        </div>
        <Badge variant={STATUS_BADGE[s.status]}>{STATUS_LABEL[s.status]}</Badge>
      </div>
      <div className="flex items-baseline justify-between mb-3">
        <span className="text-xl font-bold text-slate-900 dark:text-zinc-50">{formatCurrency(s.value)}</span>
        <span className="text-xs text-muted">{PERIODICITY_LABELS[s.periodicity]}{s.periodicity==='custom' && ` (${s.customIntervalMonths}m)`}</span>
      </div>
      <div className="text-xs text-muted mb-4 space-y-0.5">
        <p>Forma de pagamento: {s.paymentMethod === 'credit' ? `Cartão ${s.card?.name ?? ''}` : PM_LABELS[s.paymentMethod]}</p>
        {s.status === 'active' && <p>Próxima cobrança: {formatShortDate(s.nextChargeDate)}</p>}
        {s.endDate && <p>Encerra em: {formatShortDate(s.endDate)}</p>}
      </div>
      {['active','paused'].includes(s.status) && (
        <div className="flex gap-2">
          {s.status === 'active'
            ? <Button size="sm" variant="ghost" onClick={() => onPause(s)}>Pausar</Button>
            : <Button size="sm" onClick={() => onResume(s)}>Retomar</Button>}
          <Button size="sm" variant="ghost" onClick={() => onEdit(s)}>Editar</Button>
          <Button size="sm" variant="ghost" className="text-danger" onClick={() => onCancel(s)}>Cancelar</Button>
        </div>
      )}
    </Card>
  );
}

const emptyForm = {
  description: '', categoryId: '', value: '', paymentMethod: 'pix', cardId: '',
  periodicity: 'monthly', customIntervalMonths: '3', nextChargeDate: todayISO(), endDate: '', hasEndDate: false,
};

export default function SubscriptionsPage() {
  const selectedMonthId = useMonthStore((s) => s.selectedMonthId);
  const toast = useUIStore((s) => s);

  const [subscriptions, setSubscriptions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);

  const [modal, setModal] = useState(false);
  const [editModal, setEditModal] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [subs, cats, crds] = await Promise.all([
        subscriptionsApi.list(),
        categoriesApi.list('expense'),
        cardsApi.list(),
      ]);
      setSubscriptions(subs.data.subscriptions ?? []);
      setCategories(cats.data.categories ?? []);
      setCards((crds.data.cards ?? []).filter((c) => c.active));
    } catch (e) { toast.error(extractErrorMessage(e, 'Erro ao carregar assinaturas.')); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setForm({ ...emptyForm, categoryId: categories[0]?.id ?? '' });
    setModal(true);
  }

  function openEdit(s) {
    setEditModal(s);
    setForm({
      description: s.description, categoryId: String(s.categoryId), value: String(s.value),
      paymentMethod: s.paymentMethod, cardId: s.cardId ? String(s.cardId) : '',
      periodicity: s.periodicity, customIntervalMonths: String(s.customIntervalMonths ?? 3),
      nextChargeDate: s.nextChargeDate?.slice(0, 10) ?? todayISO(),
      endDate: s.endDate?.slice(0, 10) ?? '', hasEndDate: Boolean(s.endDate),
    });
  }

  async function save() {
    if (!form.description || !form.value) { toast.error('Preencha descrição e valor.'); return; }
    if (form.paymentMethod === 'credit' && !form.cardId) { toast.error('Selecione o cartão.'); return; }
    if (form.periodicity === 'custom' && !form.customIntervalMonths) { toast.error('Informe o intervalo em meses.'); return; }
    setSaving(true);
    try {
      const payload = {
        description: form.description,
        categoryId: form.categoryId,
        value: parseFloat(form.value),
        paymentMethod: form.paymentMethod,
        periodicity: form.periodicity,
        ...(form.paymentMethod === 'credit' ? { cardId: form.cardId } : {}),
        ...(form.periodicity === 'custom' ? { customIntervalMonths: parseInt(form.customIntervalMonths) } : {}),
        ...(form.hasEndDate && form.endDate ? { endDate: form.endDate } : {}),
      };
      if (editModal) {
        await subscriptionsApi.update(editModal.id, payload);
        toast.success('Assinatura atualizada.');
      } else {
        await subscriptionsApi.create({ ...payload, monthId: selectedMonthId, nextChargeDate: form.nextChargeDate });
        toast.success('Assinatura criada.');
      }
      setModal(false); setEditModal(null); load();
    } catch (e) { toast.error(extractErrorMessage(e, 'Erro ao salvar assinatura.')); }
    finally { setSaving(false); }
  }

  async function pause(s)  { try { await subscriptionsApi.pause(s.id);  toast.success('Assinatura pausada.');  load(); } catch (e) { toast.error(extractErrorMessage(e, 'Erro.')); } }
  async function resume(s) { try { await subscriptionsApi.resume(s.id); toast.success('Assinatura retomada.'); load(); } catch (e) { toast.error(extractErrorMessage(e, 'Erro.')); } }
  async function cancel(s) {
    if (!confirm(`Cancelar "${s.description}"? Essa ação não pode ser desfeita.`)) return;
    try { await subscriptionsApi.cancel(s.id); toast.success('Assinatura cancelada.'); load(); }
    catch (e) { toast.error(extractErrorMessage(e, 'Erro.')); }
  }

  const active = subscriptions.filter((s) => s.status === 'active');
  const paused = subscriptions.filter((s) => s.status === 'paused');
  const other  = subscriptions.filter((s) => ['cancelled','completed'].includes(s.status));
  const monthlyTotal = active.reduce((sum, s) => {
    const monthlyEquivalent = s.periodicity === 'monthly' ? Number(s.value)
      : s.periodicity === 'annual' ? Number(s.value) / 12
      : Number(s.value) / (s.customIntervalMonths || 1);
    return sum + monthlyEquivalent;
  }, 0);


  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-xl text-slate-900 dark:text-zinc-50">Assinaturas</h2>
          <p className="text-sm text-muted mt-0.5">
            {active.length} ativa(s) · equivalente a {formatCurrency(monthlyTotal)}/mês
          </p>
        </div>
        <Button data-tutorial="new-subscription-button" onClick={openCreate}>+ Nova Assinatura</Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">{Array.from({length:3}).map((_,i)=><Skeleton key={i} className="h-40" />)}</div>
      ) : subscriptions.length === 0 ? (
        <EmptyState icon="🔁" title="Nenhuma assinatura cadastrada"
          description="Netflix, academia, plano de corte — qualquer cobrança recorrente que não seja mensal fixa comum."
          action={<Button onClick={openCreate}>+ Nova Assinatura</Button>} />
      ) : (
        <>
          {active.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-slate-600 dark:text-zinc-400 mb-3">Ativas ({active.length})</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">{active.map((s) => (
                <SubscriptionCard key={s.id} s={s} onPause={pause} onResume={resume} onEdit={openEdit} onCancel={cancel} />
              ))}</div>
            </div>
          )}
          {paused.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-slate-600 dark:text-zinc-400 mb-3">Pausadas ({paused.length})</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">{paused.map((s) => (
                <SubscriptionCard key={s.id} s={s} onPause={pause} onResume={resume} onEdit={openEdit} onCancel={cancel} />
              ))}</div>
            </div>
          )}
          {other.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-muted mb-3">Histórico ({other.length})</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">{other.map((s) => (
                <SubscriptionCard key={s.id} s={s} onPause={pause} onResume={resume} onEdit={openEdit} onCancel={cancel} />
              ))}</div>
            </div>
          )}
        </>
      )}

      <Modal open={modal || !!editModal} onClose={() => { setModal(false); setEditModal(null); }}
        title={editModal ? 'Editar Assinatura' : 'Nova Assinatura'} size="sm">
        <div className="space-y-4">
          <FormGroup label="Descrição" required>
            <Input value={form.description} onChange={(e) => setForm({...form,description:e.target.value})} placeholder="Netflix, academia..." />
          </FormGroup>
          <FormGroup label="Categoria">
            <CategorySelect value={form.categoryId} onChange={(e) => setForm({...form,categoryId:e.target.value})}
              categories={categories} type="expense" onCategoryCreated={(cat) => setCategories((p) => [...p, cat])} />
          </FormGroup>
          <FormGroup label="Valor" required>
            <Input type="number" min="0" step="0.01" value={form.value} onChange={(e) => setForm({...form,value:e.target.value})} />
          </FormGroup>
          <FormGroup label="Forma de pagamento" required>
            <Select value={form.paymentMethod} onChange={(e) => setForm({...form, paymentMethod:e.target.value, cardId: e.target.value === 'credit' ? form.cardId : ''})}>
              {Object.entries(PM_LABELS).map(([v,l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </FormGroup>
          {form.paymentMethod === 'credit' && (
            <FormGroup label="Cartão" required>
              <Select value={form.cardId} onChange={(e) => setForm({...form,cardId:e.target.value})}>
                <option value="">Selecione...</option>
                {cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </FormGroup>
          )}
          <FormGroup label="Periodicidade" required>
            <Select value={form.periodicity} onChange={(e) => setForm({...form,periodicity:e.target.value})}>
              {Object.entries(PERIODICITY_LABELS).map(([v,l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </FormGroup>
          {form.periodicity === 'custom' && (
            <FormGroup label="Repete a cada quantos meses?" required>
              <Input type="number" min="1" max="60" value={form.customIntervalMonths} onChange={(e) => setForm({...form,customIntervalMonths:e.target.value})} />
            </FormGroup>
          )}
          {!editModal && (
            <FormGroup label="Data da próxima cobrança" required>
              <Input type="date" value={form.nextChargeDate} onChange={(e) => setForm({...form,nextChargeDate:e.target.value})} />
            </FormGroup>
          )}
          <FormGroup label="Data de encerramento">
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-zinc-400 mb-2">
              <input type="checkbox" checked={form.hasEndDate} onChange={(e) => setForm({...form,hasEndDate:e.target.checked})} />
              Tem data para acabar (senão, indefinida)
            </label>
            {form.hasEndDate && (
              <Input type="date" value={form.endDate} onChange={(e) => setForm({...form,endDate:e.target.value})} />
            )}
          </FormGroup>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={() => { setModal(false); setEditModal(null); }} className="flex-1 justify-center">Cancelar</Button>
            <Button onClick={save} loading={saving} className="flex-1 justify-center">Salvar</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
