import { useState, useEffect, useCallback } from 'react';
import { useMonthStore } from '../store/monthStore';
import { incomesApi, categoriesApi } from '../lib/services';
import { extractErrorMessage } from '../lib/api';
import { formatCurrency, formatShortDate } from '../lib/format';
import { ledgerMonthDateInputValue, ledgerMonthDateRange } from '../lib/date';
import { Card, Badge, Button, EmptyState, Skeleton } from '../components/ui/index';
import { Modal, ConfirmDialog, FormGroup, Input } from '../components/ui/Modal';
import { CategorySelect } from '../components/ui/CategorySelect';
import { useUIStore } from '../store/uiStore';
import { ChoiceCards, ToggleSwitch } from '../components/ui/Motion';
import {
  ACCOUNT_BALANCE_METHOD,
  RECEIPT_OPTIONS,
  PHYSICAL_CASH_METHOD,
  getPaymentMethodLabel,
  incomeOriginForPaymentMethod,
} from '../lib/paymentMethods';

const createEmptyForm = (month) => ({
  description:'', value:'', categoryId:'', paymentMethod: ACCOUNT_BALANCE_METHOD,
  origin:'digital', date: ledgerMonthDateInputValue(month),
  observation:'', recurring: false,
});

export default function IncomesPage() {
  const selectedMonthId = useMonthStore((s) => s.selectedMonthId);
  const selectedMonth = useMonthStore((s) => s.months.find((month) => String(month.id) === String(s.selectedMonthId)) ?? null);
  const [incomes, setIncomes]       = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [modalOpen, setModalOpen]   = useState(false);
  const [editing, setEditing]       = useState(null);
  const [form, setForm]             = useState(() => createEmptyForm(selectedMonth));
  const [saving, setSaving]         = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting]     = useState(false);
  const [stopRecurringTarget, setStopRecurringTarget] = useState(null);
  const [stoppingRecurring, setStoppingRecurring] = useState(false);
  const toast = useUIStore((s) => s);

  const load = useCallback(async () => {
    if (!selectedMonthId) return;
    setLoading(true);
    try {
      const [inc, cats] = await Promise.all([
        incomesApi.list(selectedMonthId),
        categoriesApi.list('income'),
      ]);
      setIncomes(inc.data.incomes ?? []);
      setCategories(cats.data.categories ?? []);
    } catch { toast.error('Erro ao carregar receitas.'); }
    finally  { setLoading(false); }
  }, [selectedMonthId]);

  useEffect(() => { load(); }, [load]);

  function openCreate() { setEditing(null); setForm(createEmptyForm(selectedMonth)); setModalOpen(true); }
  function openEdit(income) {
    setEditing(income);
    setForm({
      description:   income.description,
      value:         String(income.value),
      categoryId:    String(income.categoryId),
      paymentMethod: income.origin === 'physical' ? PHYSICAL_CASH_METHOD : ACCOUNT_BALANCE_METHOD,
      origin:        income.origin === 'physical' ? 'physical' : 'digital',
      date:          income.incomeDate?.slice(0,10) ?? '',
      observation:   income.observation ?? '',
      recurring:     false,
    });
    setModalOpen(true);
  }

  async function handleSave() {
    if (!form.description || !form.value || !form.categoryId) {
      toast.error('Preencha descrição, valor e categoria.'); return;
    }
    setSaving(true);
    try {
      const payload = { ...form, value: parseFloat(form.value), monthId: selectedMonthId };
      if (editing) {
        await incomesApi.update(editing.id, payload);
        toast.success('Receita atualizada.');
      } else {
        await incomesApi.create(payload);
        toast.success('Receita criada.');
      }
      setModalOpen(false);
      load();
    } catch (e) { toast.error(extractErrorMessage(e, 'Erro ao salvar.')); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await incomesApi.delete(deleteTarget.id);
      toast.success('Receita removida.'); setDeleteTarget(null); load();
    } catch (e) { toast.error(extractErrorMessage(e, 'Erro ao excluir.')); }
    finally { setDeleting(false); }
  }

  async function handleStopRecurring() {
    setStoppingRecurring(true);
    try {
      await incomesApi.deactivateTemplate(stopRecurringTarget.templateId);
      toast.success('Recorrência interrompida. Este mês não é afetado, só os próximos.');
      setStopRecurringTarget(null); load();
    } catch (e) { toast.error(extractErrorMessage(e, 'Erro ao parar recorrência.')); }
    finally { setStoppingRecurring(false); }
  }

  const total = incomes.reduce((s, i) => s + Number(i.value), 0);
  const selectedMonthDateRange = ledgerMonthDateRange(selectedMonth);

  return (
    <div data-tutorial-page-ready={!loading ? 'incomes' : undefined} className="space-y-5 animate-page-enter">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-[-0.025em] text-slate-950 dark:text-white">Receitas</h2>
          <p className="text-sm text-muted mt-0.5">Total: <span className="font-mono font-bold text-primary-dark dark:text-primary-light">{formatCurrency(total)}</span></p>
        </div>
        <Button data-tutorial="new-income" onClick={openCreate}>+ Nova Receita</Button>
      </div>

      <Card padding={false}>
        {loading ? (
          <div className="p-5 space-y-3">{Array.from({length:4}).map((_,i)=><Skeleton key={i} className="h-12" />)}</div>
        ) : incomes.length === 0 ? (
          <EmptyState icon="💰" title="Nenhuma receita neste mês"
            description="Adicione sua primeira receita para começar a acompanhar suas finanças."
            action={<Button onClick={openCreate}>Adicionar receita</Button>} />
        ) : (
          <div className="data-table-scroll">
            <table className="responsive-stack-table w-full text-sm">
              <thead className="bg-subtle/60 dark:bg-white/[0.03]">
                <tr>{['Descrição','Categoria','Valor','Data','Forma','Recorrente',''].map(h=>(
                  <th key={h} className="table-header">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-border/60 dark:divide-white/[0.06]">
                {incomes.map((inc) => (
                  <tr key={inc.id} className="hover:bg-subtle/40 dark:hover:bg-white/[0.03] transition-colors">
                    <td data-label="Descrição" className="table-cell font-semibold text-slate-800 dark:text-zinc-200">{inc.description}</td>
                    <td data-label="Categoria" className="table-cell text-muted">{inc.category?.name}</td>
                    <td data-label="Valor" className="table-cell font-mono tabular-nums font-bold text-primary-dark dark:text-primary-light">{formatCurrency(inc.value)}</td>
                    <td data-label="Data" className="table-cell text-muted">{formatShortDate(inc.incomeDate)}</td>
                    <td data-label="Forma" className="table-cell"><Badge>{getPaymentMethodLabel(inc.origin === 'physical' ? PHYSICAL_CASH_METHOD : ACCOUNT_BALANCE_METHOD)}</Badge></td>
                    <td data-label="Recorrente" className="table-cell">
                      {inc.templateId ? (
                        <div className="flex items-center gap-2">
                          <Badge variant="success">Sim</Badge>
                          <button onClick={() => setStopRecurringTarget(inc)} className="text-xs text-muted hover:text-danger underline decoration-dotted">
                            parar
                          </button>
                        </div>
                      ) : <span className="text-muted text-xs">Não</span>}
                    </td>
                    <td data-label="Ações" className="table-cell">
                      <div className="flex flex-wrap gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(inc)}>Editar</Button>
                        <Button variant="ghost" size="sm" className="text-danger" onClick={() => setDeleteTarget(inc)}>Excluir</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Editar Receita' : 'Nova Receita'} size="md">
        <div className="space-y-4">
          <FormGroup label="Descrição" required>
            <Input value={form.description} onChange={(e) => setForm({...form,description:e.target.value})} placeholder="Ex: Salário, Freelance..." />
          </FormGroup>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormGroup label="Valor" required>
              <Input type="number" min="0" step="0.01" value={form.value} onChange={(e) => setForm({...form,value:e.target.value})} placeholder="0,00" />
            </FormGroup>
            <FormGroup label="Data" required>
              <Input type="date" min={selectedMonthDateRange.min} max={selectedMonthDateRange.max} value={form.date} onChange={(e) => setForm({...form,date:e.target.value})} />
            </FormGroup>
          </div>
          <FormGroup label="Categoria" required>
            <CategorySelect
              value={form.categoryId}
              onChange={(e) => setForm({...form,categoryId:e.target.value})}
              categories={categories}
              type="income"
              onCategoryCreated={(cat) => setCategories((prev) => [...prev, cat])}
            />
          </FormGroup>
          <FormGroup label="Forma de recebimento">
            <ChoiceCards
              compact
              columns={2}
              value={form.paymentMethod}
              onChange={(paymentMethod) => setForm({
                ...form,
                paymentMethod,
                origin: incomeOriginForPaymentMethod(paymentMethod),
              })}
              options={RECEIPT_OPTIONS}
            />
          </FormGroup>
          <FormGroup label="Observação">
            <Input value={form.observation} onChange={(e) => setForm({...form,observation:e.target.value})} placeholder="Opcional" />
          </FormGroup>
          {!editing && (
            <ToggleSwitch checked={form.recurring} onChange={(recurring) => setForm({ ...form, recurring })} label="Receita recorrente" description="Será gerada automaticamente todo mês ao fechar o período." />
          )}
          <div className="modal-actions">
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} loading={saving}>Salvar</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete}
        loading={deleting} title="Excluir receita"
        description={`Excluir "${deleteTarget?.description}"? Esta ação não pode ser desfeita.`}
        confirmLabel="Excluir" />

      <ConfirmDialog open={!!stopRecurringTarget} onClose={() => setStopRecurringTarget(null)} onConfirm={handleStopRecurring}
        loading={stoppingRecurring} title="Parar recorrência" variant="primary"
        description={`"${stopRecurringTarget?.description}" não será mais gerada automaticamente nos próximos meses. As receitas já lançadas em meses anteriores (incluindo este) continuam como estão.`}
        confirmLabel="Parar recorrência" />
    </div>
  );
}