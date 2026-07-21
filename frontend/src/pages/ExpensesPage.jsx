import { useState, useEffect, useCallback } from 'react';
import { useMonthStore } from '../store/monthStore';
import { expensesApi, debtsApi, categoriesApi, cardsApi } from '../lib/services';
import { extractErrorMessage } from '../lib/api';
import { formatCurrency, formatShortDate } from '../lib/format';
import { Card, Badge, Button, EmptyState, Skeleton, TabGroup } from '../components/ui/index';
import { Modal, ConfirmDialog, FormGroup, Input, Select } from '../components/ui/Modal';
import { CategorySelect } from '../components/ui/CategorySelect';
import { useUIStore } from '../store/uiStore';
import { localDateInputValue, apiDateToInput } from '../lib/date';

const PM_LABELS = { cash:'Dinheiro', pix:'PIX', debit:'Débito', credit:'Crédito', transfer:'Transferência' };
const STATUS_V  = { pending:'warning', partial:'info', paid:'success', late:'danger', settled:'success' };
const STATUS_L  = { pending:'Pendente', partial:'Parcial', paid:'Pago', late:'Atrasado', settled:'Quitado' };

export default function ExpensesPage() {
  const selectedMonthId = useMonthStore((s) => s.selectedMonthId);
  const [tab, setTab]       = useState('priority');
  const [expenses, setExpenses] = useState([]);
  const [debts, setDebts]   = useState([]);
  const [categories, setCategories] = useState([]);
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const toast = useUIStore((s) => s);

  // ── Modais de pagamento ──
  const [payModal, setPayModal]   = useState(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('pix');
  const [paying, setPaying]       = useState(false);

  // ── Modal nova despesa variável ──
  const [varModal, setVarModal] = useState(false);
  const [varForm, setVarForm]   = useState({ description:'', value:'', categoryId:'', date: localDateInputValue(), paymentMethod:'pix', paid:true, cardId:'' });

  // ── Modal editar despesa variável ──
  const [editVarModal, setEditVarModal] = useState(null);
  const [editVarForm, setEditVarForm]   = useState({ description:'', value:'', categoryId:'', dueDate:'', observation:'' });

  // ── Modal nova despesa fixa ──
  const [fixModal, setFixModal] = useState(false);
  const [fixForm, setFixForm]   = useState({ description:'', value:'', categoryId:'', dueDay:'10', paymentMethod:'transfer', cardId:'' });

  // ── Modal editar despesa fixa ──
  const [editFixModal, setEditFixModal] = useState(null);
  const [editFixForm, setEditFixForm]   = useState({ description:'', value:'', dueDay:'', paymentMethod:'transfer', cardId:'' });

  // ── Modal nova dívida ──
  const [debtModal, setDebtModal] = useState(false);
  const [debtForm, setDebtForm]   = useState({ description:'', categoryId:'', totalValue:'', installmentsCount:'1', flexiblePayment:false, dueDay:'10', startingInstallment:'1' });

  // ── Modal editar dívida ──
  const [editDebtModal, setEditDebtModal] = useState(null);
  const [editDebtForm, setEditDebtForm]   = useState({ description:'', categoryId:'', dueDay:'', flexiblePayment:false });

  // ── Delete e saving ──
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting]   = useState(false);
  const [saving, setSaving]       = useState(false);

  const load = useCallback(async () => {
    if (!selectedMonthId) return;
    setLoading(true);
    try {
      const [exp, dbt, cats, crds] = await Promise.all([
        expensesApi.list(selectedMonthId),
        debtsApi.list(),
        categoriesApi.list('expense'),
        cardsApi.list(),
      ]);
      setExpenses(exp.data.expenses ?? []);
      setDebts(dbt.data.debts ?? []);
      setCategories(cats.data.categories ?? []);
      setCards((crds.data.cards ?? []).filter((c) => c.active));
    } catch { toast.error('Erro ao carregar despesas.'); }
    finally  { setLoading(false); }
  }, [selectedMonthId]);

  useEffect(() => { load(); }, [load]);

  const tabs = [
    { value:'priority', label:'Prioridade', count: expenses.filter(e=>e.type==='priority').length },
    { value:'fixed',    label:'Fixas',      count: expenses.filter(e=>e.fixedTemplateId).length },
    { value:'variable', label:'Variáveis',  count: expenses.filter(e=>e.type==='variable').length },
  ];

  const filtered = expenses.filter((e) => tab === 'fixed' ? !!e.fixedTemplateId : e.type === tab);

  // ── Handlers ────────────────────────────────────────────
  function openPay(e) { setPayModal(e); setPayAmount(String(e.value)); setPayMethod('pix'); }

  async function handlePay() {
    if (!payAmount || parseFloat(payAmount) <= 0) { toast.error('Informe um valor válido.'); return; }
    setPaying(true);
    try {
      await expensesApi.pay(payModal.id, { amount: parseFloat(payAmount), paymentMethod: payMethod });
      toast.success('Pagamento registrado com sucesso.');
      setPayModal(null);
      load();
    } catch (e) { toast.error(extractErrorMessage(e, 'Erro ao pagar.')); }
    finally { setPaying(false); }
  }

  async function saveVariable() {
    if (!varForm.description || !varForm.value) { toast.error('Preencha descrição e valor.'); return; }
    setSaving(true);
    try {
      const cat = varForm.categoryId || (categories[0]?.id ?? '');
      if (varForm.paymentMethod === 'credit' && !varForm.cardId) { toast.error('Selecione o cartão.'); return; }
      const { cardId, ...rest } = varForm;
      await expensesApi.createVariable({
        ...rest,
        value: parseFloat(varForm.value),
        categoryId: String(cat),
        monthId: selectedMonthId,
        ...(varForm.paymentMethod === 'credit' ? { cardId } : {}),
      });
      toast.success('Despesa variável criada.'); setVarModal(false); load();
    } catch (e) { toast.error(extractErrorMessage(e, 'Erro.')); }
    finally { setSaving(false); }
  }

  async function saveEditVariable() {
    if (!editVarForm.description || !editVarForm.value) { toast.error('Preencha descrição e valor.'); return; }
    setSaving(true);
    try {
      await expensesApi.update(editVarModal.id, {
        description: editVarForm.description,
        value: parseFloat(editVarForm.value),
        categoryId: String(editVarForm.categoryId),
        dueDate: editVarForm.dueDate,
        observation: editVarForm.observation || undefined,
      });
      toast.success('Despesa atualizada.'); setEditVarModal(null); load();
    } catch (e) { toast.error(extractErrorMessage(e, 'Erro ao atualizar despesa.')); }
    finally { setSaving(false); }
  }

  async function saveFixed() {
    if (!fixForm.description || !fixForm.value) { toast.error('Preencha descrição e valor.'); return; }
    if (fixForm.paymentMethod === 'credit' && !fixForm.cardId) { toast.error('Selecione o cartão.'); return; }
    setSaving(true);
    try {
      const cat = fixForm.categoryId || (categories[0]?.id ?? '');
      const { cardId, ...rest } = fixForm;
      await expensesApi.createFixed({
        ...rest,
        value: parseFloat(fixForm.value),
        dueDay: parseInt(fixForm.dueDay),
        categoryId: String(cat),
        monthId: selectedMonthId,
        ...(fixForm.paymentMethod === 'credit' ? { cardId } : {}),
      });
      toast.success('Despesa fixa criada.'); setFixModal(false); load();
    } catch (e) { toast.error(extractErrorMessage(e, 'Erro.')); }
    finally { setSaving(false); }
  }

  async function saveEditFixed() {
    if (!editFixForm.description || !editFixForm.value) { toast.error('Preencha os campos.'); return; }
    if (editFixForm.paymentMethod === 'credit' && !editFixForm.cardId) { toast.error('Selecione o cartão.'); return; }
    setSaving(true);
    try {
      await expensesApi.updateFixedTemplate(editFixModal.fixedTemplateId, {
        description: editFixForm.description,
        value: parseFloat(editFixForm.value),
        dueDay: parseInt(editFixForm.dueDay),
        paymentMethod: editFixForm.paymentMethod,
        ...(editFixForm.paymentMethod === 'credit' ? { cardId: editFixForm.cardId } : {}),
      });
      toast.success('Despesa fixa atualizada. Próximos meses refletirão a mudança.'); setEditFixModal(null); load();
    } catch (e) { toast.error(extractErrorMessage(e, 'Erro.')); }
    finally { setSaving(false); }
  }

  async function handleDeleteFixed(expense) {
    setSaving(true);
    try {
      if (expense.fixedTemplateId) {
        await expensesApi.deleteFixedTemplate(expense.fixedTemplateId);
        toast.success('Despesa fixa removida. Não será mais gerada nos próximos meses.');
      } else {
        await expensesApi.delete(expense.id);
        toast.success('Despesa removida.');
      }
      setDeleteTarget(null); load();
    } catch (e) { toast.error(extractErrorMessage(e, 'Erro ao remover.')); }
    finally { setSaving(false); }
  }

  async function saveDebt() {
    if (!debtForm.description || !debtForm.totalValue) { toast.error('Preencha descrição e valor total.'); return; }
    setSaving(true);
    try {
      const cat = debtForm.categoryId || (categories[0]?.id ?? '');
      await debtsApi.create({ ...debtForm, totalValue: parseFloat(debtForm.totalValue), installmentsCount: parseInt(debtForm.installmentsCount), dueDay: parseInt(debtForm.dueDay), startingInstallment: parseInt(debtForm.startingInstallment) || 1, categoryId: String(cat), monthId: selectedMonthId });
      toast.success('Dívida criada com sucesso.'); setDebtModal(false); load();
    } catch (e) { toast.error(extractErrorMessage(e, 'Erro.')); }
    finally { setSaving(false); }
  }

  async function handleDeleteVariable(expense) {
    setDeleting(true);
    try {
      await expensesApi.delete(expense.id);
      toast.success('Despesa removida.'); setDeleteTarget(null); load();
    } catch (e) { toast.error(extractErrorMessage(e, 'Erro.')); }
    finally { setDeleting(false); }
  }

  async function saveEditDebt() {
    if (!editDebtForm.description) { toast.error('Preencha a descrição.'); return; }
    setSaving(true);
    try {
      await debtsApi.update(editDebtModal.id, {
        description: editDebtForm.description,
        categoryId: String(editDebtForm.categoryId),
        dueDay: parseInt(editDebtForm.dueDay),
        flexiblePayment: editDebtForm.flexiblePayment,
      });
      toast.success('Dívida atualizada.'); setEditDebtModal(null); load();
    } catch (e) { toast.error(extractErrorMessage(e, 'Erro.')); }
    finally { setSaving(false); }
  }

  async function handleDeleteDebt(debt) {
    setDeleting(true);
    try {
      await debtsApi.delete(debt.id);
      toast.success('Dívida removida. A parcela deste mês foi excluída e não haverá novas parcelas.');
      setDeleteTarget(null); load();
    } catch (e) { toast.error(extractErrorMessage(e, 'Erro ao remover dívida.')); }
    finally { setDeleting(false); }
  }

  // ── Render ────────────────────────────────────────────────
  // Antes era `const AddButton = () => (...)`, usado como `<AddButton />`.
  // Mesmo sem campo de texto (é só um botão), uma função-componente
  // recriada a cada render do pai perde a identidade estável que o React
  // usa pra decidir "atualizar" em vez de "desmontar e remontar" — igual
  // ao problema corrigido em WhatIfSimulatorPage.jsx. Aqui a correção é
  // mais simples: como não precisa de props próprias, basta parar de
  // tratar como um componente (JSX `<Tag />`) e guardar o elemento pronto
  // numa variável comum, inserida com `{addButton}`.
  const addButton = (
    <Button data-tutorial="new-expense-button" size="sm" onClick={() => {
      if (tab === 'variable') { setVarForm({ description:'', value:'', categoryId:'', date: localDateInputValue(), paymentMethod:'pix', paid:true, cardId:'' }); setVarModal(true); }
      if (tab === 'fixed')    { setFixForm({ description:'', value:'', categoryId:'', dueDay:'10', paymentMethod:'transfer', cardId:'' }); setFixModal(true); }
      if (tab === 'priority') { setDebtForm({ description:'', categoryId:'', totalValue:'', installmentsCount:'1', flexiblePayment:false, dueDay:'10', startingInstallment:'1' }); setDebtModal(true); }
    }}>
      + {tab === 'variable' ? 'Nova Despesa' : tab === 'fixed' ? 'Nova Fixa' : 'Nova Dívida'}
    </Button>
  );

  return (
    <div className="space-y-5 animate-page-enter">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-2xl font-bold tracking-[-0.025em] text-slate-950 dark:text-white">Despesas</h2>
        {addButton}
      </div>

      <div data-tutorial="expense-tabs"><TabGroup tabs={tabs} value={tab} onChange={setTab} /></div>

      <Card padding={false}>
        {loading ? (
          <div className="p-5 space-y-3">{Array.from({length:4}).map((_,i)=><Skeleton key={i} className="h-12" />)}</div>
        ) : filtered.length === 0 ? (
          <EmptyState icon="📋" title={`Nenhuma despesa ${tab === 'priority' ? 'de prioridade' : tab === 'fixed' ? 'fixa' : 'variável'}`}
            description="Adicione uma nova despesa clicando no botão acima."
            action={addButton} />
        ) : tab === 'priority' ? (
          /* ── Tabela Prioridade ── */
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-subtle/60 dark:bg-white/[0.03]">
                <tr>
                  {['Descrição','Parcela','Pago','Saldo Devedor','Vencimento','Status','Ações'].map(h=>(
                    <th key={h} className="table-header">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60 dark:divide-white/[0.06]">
                {filtered.map((e) => {
                  const debt = debts.find((d) => String(d.id) === String(e.debtId));
                  // 'partial' só é possível em parcelas de dívida (fixa/variável
                  // sempre exigem valor exato) — e agora que pagar menos/mais
                  // ajusta a PRÓXIMA parcela automaticamente, a diferença já foi
                  // propagada, então esta parcela específica fica encerrada.
                  const alreadyPaid = ['paid','settled','partial'].includes(e.status);
                  return (
                    <tr key={e.id} className="hover:bg-subtle/40 dark:hover:bg-white/[0.03] transition-colors">
                      <td className="table-cell font-semibold text-slate-800 dark:text-zinc-200">{e.description}</td>
                      <td className="table-cell font-mono tabular-nums">{formatCurrency(e.value)}</td>
                      <td className="table-cell font-mono tabular-nums text-primary-dark">{formatCurrency(e.paidAmount)}</td>
                      <td className="table-cell font-mono tabular-nums text-danger-dark font-semibold">
                        {debt ? formatCurrency(debt.remainingBalance) : '—'}
                      </td>
                      <td className="table-cell text-muted">{formatShortDate(e.dueDate)}</td>
                      <td className="table-cell">
                        <Badge variant={STATUS_V[e.status] ?? 'default'}>{STATUS_L[e.status] ?? e.status}</Badge>
                      </td>
                      <td className="table-cell">
                        <div className="flex items-center gap-2">
                          {!alreadyPaid && (
                            <Button size="sm" onClick={() => openPay(e)}>Pagar</Button>
                          )}
                          {alreadyPaid && (
                            <span className="text-xs text-primary-dark font-medium flex items-center gap-1" title={e.status === 'partial' ? 'O ajuste da diferença já foi aplicado à próxima parcela.' : undefined}>
                              ✓ {e.status === 'partial' ? 'Pago (parcial)' : 'Pago'}
                            </span>
                          )}
                          {debt && (
                            <>
                              <Button size="sm" variant="ghost" onClick={() => {
                                setEditDebtModal(debt);
                                setEditDebtForm({
                                  description: debt.description,
                                  categoryId: String(debt.categoryId),
                                  dueDay: String(debt.dueDay),
                                  flexiblePayment: !!debt.flexiblePayment,
                                });
                              }}>Editar</Button>
                              <Button size="sm" variant="ghost" className="text-danger hover:text-danger-dark" onClick={() => setDeleteTarget({ ...debt, _type:'debt' })}>
                                Remover
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : tab === 'fixed' ? (
          /* ── Tabela Fixas ── */
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-subtle/60 dark:bg-white/[0.03]">
                <tr>
                  {['Descrição','Categoria','Valor','Vencimento','Status','Ações'].map(h=>(
                    <th key={h} className="table-header">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60 dark:divide-white/[0.06]">
                {filtered.map((e) => (
                  <tr key={e.id} className="hover:bg-subtle/40 dark:hover:bg-white/[0.03] transition-colors">
                    <td className="table-cell font-semibold text-slate-800 dark:text-zinc-200">{e.description}</td>
                    <td className="table-cell text-muted">{e.category?.name}</td>
                    <td className="table-cell font-mono tabular-nums">{formatCurrency(e.value)}</td>
                    <td className="table-cell text-muted">{formatShortDate(e.dueDate)}</td>
                    <td className="table-cell">
                      <Badge variant={STATUS_V[e.status] ?? 'default'}>{STATUS_L[e.status] ?? e.status}</Badge>
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center gap-2">
                        {e.type === 'card' ? (
                          <span className="text-xs text-info-dark bg-info-subtle px-2 py-1 rounded-lg font-medium">
                            💳 Fatura {e.cardInvoice?.card?.name ?? 'do cartão'}
                          </span>
                        ) : !['paid','settled'].includes(e.status) && (
                          <Button size="sm" onClick={() => openPay(e)}>Pagar</Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => {
                          setEditFixModal(e);
                          setEditFixForm({
                            description: e.description,
                            value: String(e.value),
                            dueDay: String(e.dueDate ? new Date(e.dueDate).getUTCDate() : '10'),
                            paymentMethod: e.fixedTemplate?.paymentMethod ?? 'transfer',
                            cardId: e.fixedTemplate?.cardId ? String(e.fixedTemplate.cardId) : '',
                          });
                        }}>Editar</Button>
                        <Button size="sm" variant="ghost" className="text-danger hover:text-danger-dark" onClick={() => setDeleteTarget({ ...e, _type:'fixed' })}>
                          Remover
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          /* ── Tabela Variáveis ── */
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-subtle/60 dark:bg-white/[0.03]">
                <tr>
                  {['Descrição','Categoria','Valor','Data','Forma','Status','Ações'].map(h=>(
                    <th key={h} className="table-header">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60 dark:divide-white/[0.06]">
                {filtered.map((e) => (
                  <tr key={e.id} className="hover:bg-subtle/40 dark:hover:bg-white/[0.03] transition-colors">
                    <td className="table-cell font-semibold text-slate-800 dark:text-zinc-200">{e.description}</td>
                    <td className="table-cell text-muted">{e.category?.name}</td>
                    <td className="table-cell font-mono tabular-nums">{formatCurrency(e.value)}</td>
                    <td className="table-cell text-muted">{formatShortDate(e.dueDate)}</td>
                    <td className="table-cell"><Badge>{PM_LABELS[e.paymentMethod] ?? e.paymentMethod}</Badge></td>
                    <td className="table-cell">
                      <Badge variant={STATUS_V[e.status] ?? 'default'}>{STATUS_L[e.status] ?? e.status}</Badge>
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="ghost" onClick={() => {
                          setEditVarModal(e);
                          setEditVarForm({
                            description: e.description,
                            value: String(e.value),
                            categoryId: e.categoryId != null ? String(e.categoryId) : '',
                            dueDate: apiDateToInput(e.dueDate),
                            observation: e.observation ?? '',
                          });
                        }}>Editar</Button>
                        <Button size="sm" variant="ghost" className="text-danger" onClick={() => setDeleteTarget({ ...e, _type:'variable' })}>
                          Excluir
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Modal Pagamento ── */}
      <Modal open={!!payModal} onClose={() => setPayModal(null)} title="Registrar Pagamento" size="sm">
        {payModal && (
          <div className="space-y-4">
            <div className="bg-subtle dark:bg-white/[0.04] rounded-2xl p-4">
              <p className="text-xs text-muted mb-1">Despesa</p>
              <p className="font-semibold text-slate-900 dark:text-zinc-50">{payModal.description}</p>
              <p className="text-sm text-muted mt-1">Valor da parcela: <span className="font-mono font-semibold text-slate-800 dark:text-zinc-200">{formatCurrency(payModal.value)}</span></p>
            </div>
            <FormGroup label="Valor pago" required>
              <Input type="number" min="0" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
            </FormGroup>
            <FormGroup label="Forma de pagamento">
              <Select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                {Object.entries(PM_LABELS).filter(([v]) => v !== 'credit').map(([v,l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </FormGroup>
            {payModal.type === 'priority' && (
              <p className="text-xs text-info bg-info-subtle p-3 rounded-xl border border-info/20">
                💡 Se pagar menos que a parcela e a dívida tiver pagamento flexível, o saldo restante será acumulado para a próxima parcela.
              </p>
            )}
            <div className="flex gap-3 justify-end pt-1">
              <Button variant="outline" onClick={() => setPayModal(null)}>Cancelar</Button>
              <Button onClick={handlePay} loading={paying}>Confirmar Pagamento</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Modal Nova Variável ── */}
      <Modal open={varModal} onClose={() => setVarModal(false)} title="Nova Despesa Variável">
        <div className="space-y-4">
          <FormGroup label="Descrição" required>
            <Input value={varForm.description} onChange={(e) => setVarForm({...varForm,description:e.target.value})} placeholder="Ex: Mercado, Lanche..." autoFocus />
          </FormGroup>
          <div className="grid grid-cols-2 gap-3">
            <FormGroup label="Valor" required>
              <Input type="number" min="0" step="0.01" value={varForm.value} onChange={(e) => setVarForm({...varForm,value:e.target.value})} />
            </FormGroup>
            <FormGroup label="Data" required>
              <Input type="date" value={varForm.date} onChange={(e) => setVarForm({...varForm,date:e.target.value})} />
            </FormGroup>
          </div>
          <FormGroup label="Categoria">
            <CategorySelect
              value={varForm.categoryId}
              onChange={(e) => setVarForm({...varForm,categoryId:e.target.value})}
              categories={categories}
              type="expense"
              onCategoryCreated={(cat) => setCategories((prev) => [...prev, cat])}
            />
          </FormGroup>
          <FormGroup label="Forma de pagamento">
            <Select value={varForm.paymentMethod} onChange={(e) => setVarForm({ ...varForm, paymentMethod:e.target.value, cardId: e.target.value === 'credit' ? varForm.cardId : '', paid: e.target.value === 'credit' ? true : varForm.paid })}>
              {Object.entries(PM_LABELS).map(([v,l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </FormGroup>
          {varForm.paymentMethod === 'credit' && (
            <FormGroup label="Cartão" required>
              <Select value={varForm.cardId} onChange={(e) => setVarForm({ ...varForm, cardId:e.target.value })}>
                <option value="">Selecione...</option>
                {cards.map((card) => <option key={card.id} value={card.id}>{card.name} — disponível {formatCurrency(card.availableLimit)}</option>)}
              </Select>
              <p className="text-xs text-muted mt-1.5">A compra entra na fatura e reduz o limite disponível imediatamente.</p>
            </FormGroup>
          )}
          {varForm.paymentMethod !== 'credit' && <label className="flex items-center gap-2.5 text-sm cursor-pointer select-none">
            <input type="checkbox" checked={varForm.paid} onChange={(e) => setVarForm({...varForm,paid:e.target.checked})} className="w-4 h-4 rounded accent-primary" />
            <span className="text-slate-700 dark:text-zinc-300">Já foi pago</span>
          </label>}
          <div className="flex gap-3 justify-end pt-1">
            <Button variant="outline" onClick={() => setVarModal(false)}>Cancelar</Button>
            <Button onClick={saveVariable} loading={saving}>Salvar</Button>
          </div>
        </div>
      </Modal>

      {/* ── Modal Nova Fixa ── */}
      <Modal open={fixModal} onClose={() => setFixModal(false)} title="Nova Despesa Fixa">
        <div className="space-y-4">
          <p className="text-xs bg-info-subtle text-info-dark p-3 rounded-xl border border-info/20">
            ℹ Despesas fixas são geradas automaticamente todo mês ao fechar o período.
          </p>
          <FormGroup label="Descrição" required>
            <Input value={fixForm.description} onChange={(e) => setFixForm({...fixForm,description:e.target.value})} placeholder="Ex: Netflix, Academia, Internet..." autoFocus />
          </FormGroup>
          <div className="grid grid-cols-2 gap-3">
            <FormGroup label="Valor mensal" required>
              <Input type="number" min="0" step="0.01" value={fixForm.value} onChange={(e) => setFixForm({...fixForm,value:e.target.value})} />
            </FormGroup>
            <FormGroup label="Dia de vencimento" required>
              <Input type="number" min="1" max="31" value={fixForm.dueDay} onChange={(e) => setFixForm({...fixForm,dueDay:e.target.value})} />
            </FormGroup>
          </div>
          <FormGroup label="Categoria">
            <CategorySelect
              value={fixForm.categoryId}
              onChange={(e) => setFixForm({...fixForm,categoryId:e.target.value})}
              categories={categories}
              type="expense"
              onCategoryCreated={(cat) => setCategories((prev) => [...prev, cat])}
            />
          </FormGroup>
          <FormGroup label="Forma de pagamento" required>
            <Select value={fixForm.paymentMethod} onChange={(e) => setFixForm({...fixForm, paymentMethod:e.target.value, cardId: e.target.value === 'credit' ? fixForm.cardId : ''})}>
              {Object.entries(PM_LABELS).map(([v,l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </FormGroup>
          {fixForm.paymentMethod === 'credit' && (
            <FormGroup label="Cartão" required>
              {cards.length === 0 ? (
                <p className="text-xs text-warning-dark bg-warning-subtle p-2.5 rounded-lg border border-warning/20">
                  Você ainda não tem nenhum cartão cadastrado. Cadastre um na página Cartões primeiro.
                </p>
              ) : (
                <Select value={fixForm.cardId} onChange={(e) => setFixForm({...fixForm,cardId:e.target.value})}>
                  <option value="">Selecione...</option>
                  {cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              )}
              <p className="text-xs text-muted mt-1.5">
                Lançada direto na fatura deste cartão todo mês — não desconta do saldo até a fatura ser paga.
              </p>
            </FormGroup>
          )}
          <div className="flex gap-3 justify-end pt-1">
            <Button variant="outline" onClick={() => setFixModal(false)}>Cancelar</Button>
            <Button onClick={saveFixed} loading={saving}>Criar Despesa Fixa</Button>
          </div>
        </div>
      </Modal>

      {/* ── Modal Editar Fixa ── */}
      <Modal open={!!editFixModal} onClose={() => setEditFixModal(null)} title="Editar Despesa Fixa" size="sm">
        <div className="space-y-4">
          <p className="text-xs bg-warning-subtle text-warning-dark p-3 rounded-xl border border-warning/20">
            ⚠ A alteração afeta apenas os <strong>próximos meses</strong>. O histórico passado permanece inalterado.
          </p>
          <FormGroup label="Descrição" required>
            <Input value={editFixForm.description} onChange={(e) => setEditFixForm({...editFixForm,description:e.target.value})} />
          </FormGroup>
          <div className="grid grid-cols-2 gap-3">
            <FormGroup label="Novo valor" required>
              <Input type="number" min="0" step="0.01" value={editFixForm.value} onChange={(e) => setEditFixForm({...editFixForm,value:e.target.value})} />
            </FormGroup>
            <FormGroup label="Dia vencimento">
              <Input type="number" min="1" max="31" value={editFixForm.dueDay} onChange={(e) => setEditFixForm({...editFixForm,dueDay:e.target.value})} />
            </FormGroup>
          </div>
          <FormGroup label="Forma de pagamento" required>
            <Select value={editFixForm.paymentMethod} onChange={(e) => setEditFixForm({...editFixForm, paymentMethod:e.target.value, cardId: e.target.value === 'credit' ? editFixForm.cardId : ''})}>
              {Object.entries(PM_LABELS).map(([v,l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </FormGroup>
          {editFixForm.paymentMethod === 'credit' && (
            <FormGroup label="Cartão" required>
              <Select value={editFixForm.cardId} onChange={(e) => setEditFixForm({...editFixForm,cardId:e.target.value})}>
                <option value="">Selecione...</option>
                {cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </FormGroup>
          )}
          <div className="flex gap-3 justify-end pt-1">
            <Button variant="outline" onClick={() => setEditFixModal(null)}>Cancelar</Button>
            <Button onClick={saveEditFixed} loading={saving}>Salvar Alteração</Button>
          </div>
        </div>
      </Modal>

      {/* ── Modal Editar Despesa Variável ── */}
      <Modal open={!!editVarModal} onClose={() => setEditVarModal(null)} title="Editar Despesa Variável" size="sm">
        <div className="space-y-4">
          <FormGroup label="Descrição" required>
            <Input value={editVarForm.description} onChange={(e) => setEditVarForm({...editVarForm,description:e.target.value})} autoFocus />
          </FormGroup>
          <div className="grid grid-cols-2 gap-3">
            <FormGroup label="Valor" required>
              <Input type="number" min="0" step="0.01" value={editVarForm.value} onChange={(e) => setEditVarForm({...editVarForm,value:e.target.value})} />
            </FormGroup>
            <FormGroup label="Data" required>
              <Input type="date" value={editVarForm.dueDate} onChange={(e) => setEditVarForm({...editVarForm,dueDate:e.target.value})} />
            </FormGroup>
          </div>
          <FormGroup label="Categoria">
            <CategorySelect
              value={editVarForm.categoryId}
              onChange={(e) => setEditVarForm({...editVarForm,categoryId:e.target.value})}
              categories={categories}
              type="expense"
              onCategoryCreated={(cat) => setCategories((prev) => [...prev, cat])}
            />
          </FormGroup>
          <FormGroup label="Observação" hint="opcional">
            <Input value={editVarForm.observation} onChange={(e) => setEditVarForm({...editVarForm,observation:e.target.value})} />
          </FormGroup>
          <p className="text-xs text-muted">
            Forma de pagamento e status (pago/pendente) não são alterados aqui — use "Pagar" na listagem para isso.
          </p>
          <div className="flex gap-3 justify-end pt-1">
            <Button variant="outline" onClick={() => setEditVarModal(null)}>Cancelar</Button>
            <Button onClick={saveEditVariable} loading={saving}>Salvar Alteração</Button>
          </div>
        </div>
      </Modal>

      {/* ── Modal Nova Dívida ── */}
      <Modal open={debtModal} onClose={() => setDebtModal(false)} title="Nova Dívida / Parcelamento">
        <div className="space-y-4">
          <FormGroup label="Descrição" required>
            <Input value={debtForm.description} onChange={(e) => setDebtForm({...debtForm,description:e.target.value})} placeholder="Ex: Empréstimo, Financiamento..." autoFocus />
          </FormGroup>
          <FormGroup label="Categoria">
            <CategorySelect
              value={debtForm.categoryId}
              onChange={(e) => setDebtForm({...debtForm,categoryId:e.target.value})}
              categories={categories}
              type="expense"
              onCategoryCreated={(cat) => setCategories((prev) => [...prev, cat])}
            />
          </FormGroup>
          <div className="grid grid-cols-3 gap-3">
            <FormGroup label="Valor total" required>
              <Input type="number" min="0" step="0.01" value={debtForm.totalValue} onChange={(e) => setDebtForm({...debtForm,totalValue:e.target.value})} />
            </FormGroup>
            <FormGroup label="Nº de parcelas" required>
              <Input type="number" min="1" max="360" value={debtForm.installmentsCount} onChange={(e) => setDebtForm({...debtForm,installmentsCount:e.target.value})} />
            </FormGroup>
            <FormGroup label="Dia venc." required>
              <Input type="number" min="1" max="31" value={debtForm.dueDay} onChange={(e) => setDebtForm({...debtForm,dueDay:e.target.value})} />
            </FormGroup>
          </div>
          {debtForm.totalValue && debtForm.installmentsCount && parseInt(debtForm.installmentsCount) > 0 && (
            <div className="bg-primary-subtle border border-primary/20 rounded-xl p-3 text-sm">
              <span className="text-primary-dark font-medium">Parcela mensal: </span>
              <span className="font-mono font-bold text-primary-dark">{formatCurrency(parseFloat(debtForm.totalValue)/parseInt(debtForm.installmentsCount))}</span>
            </div>
          )}
          <FormGroup label="Essa compra já está em andamento? (ex.: já estou na parcela 4 de 12)">
            <Input type="number" min="1" max={debtForm.installmentsCount || 360} value={debtForm.startingInstallment}
              onChange={(e) => setDebtForm({...debtForm,startingInstallment:e.target.value})} />
            <p className="text-xs text-muted mt-1.5">
              Deixe em 1 se está começando agora. Se já pagou algumas parcelas fora do app, informe qual é a próxima —
              o sistema já desconta o que foi pago antes e cria só a partir dela.
            </p>
          </FormGroup>
          <label className="flex items-center gap-2.5 text-sm cursor-pointer select-none">
            <input type="checkbox" checked={debtForm.flexiblePayment} onChange={(e) => setDebtForm({...debtForm,flexiblePayment:e.target.checked})} className="w-4 h-4 rounded accent-primary" />
            <div>
              <span className="text-slate-700 dark:text-zinc-300 font-medium">Aceitar pagamento parcial</span>
              <p className="text-xs text-muted">O valor não pago será somado à próxima parcela</p>
            </div>
          </label>
          <div className="flex gap-3 justify-end pt-1">
            <Button variant="outline" onClick={() => setDebtModal(false)}>Cancelar</Button>
            <Button onClick={saveDebt} loading={saving}>Criar Dívida</Button>
          </div>
        </div>
      </Modal>

      {/* ── Modal Editar Dívida ── */}
      <Modal open={!!editDebtModal} onClose={() => setEditDebtModal(null)} title="Editar Dívida" size="sm">
        <div className="space-y-4">
          <p className="text-xs bg-info-subtle text-info-dark p-3 rounded-xl border border-info/20">
            ℹ Valor total e número de parcelas não podem ser alterados depois de criada a dívida. Para isso, remova esta dívida e crie uma nova.
          </p>
          <FormGroup label="Descrição" required>
            <Input value={editDebtForm.description} onChange={(e) => setEditDebtForm({...editDebtForm,description:e.target.value})} />
          </FormGroup>
          <FormGroup label="Categoria">
            <CategorySelect
              value={editDebtForm.categoryId}
              onChange={(e) => setEditDebtForm({...editDebtForm,categoryId:e.target.value})}
              categories={categories}
              type="expense"
              onCategoryCreated={(cat) => setCategories((prev) => [...prev, cat])}
            />
          </FormGroup>
          <FormGroup label="Dia de vencimento">
            <Input type="number" min="1" max="31" value={editDebtForm.dueDay} onChange={(e) => setEditDebtForm({...editDebtForm,dueDay:e.target.value})} />
          </FormGroup>
          <label className="flex items-center gap-2.5 text-sm cursor-pointer select-none">
            <input type="checkbox" checked={editDebtForm.flexiblePayment} onChange={(e) => setEditDebtForm({...editDebtForm,flexiblePayment:e.target.checked})} className="w-4 h-4 rounded accent-primary" />
            <div>
              <span className="text-slate-700 dark:text-zinc-300 font-medium">Aceitar pagamento parcial</span>
              <p className="text-xs text-muted">O valor não pago será somado à próxima parcela</p>
            </div>
          </label>
          <div className="flex gap-3 justify-end pt-1">
            <Button variant="outline" onClick={() => setEditDebtModal(null)}>Cancelar</Button>
            <Button onClick={saveEditDebt} loading={saving}>Salvar Alteração</Button>
          </div>
        </div>
      </Modal>

      {/* ── Confirm Delete ── */}
      <ConfirmDialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget?._type === 'fixed') return handleDeleteFixed(deleteTarget);
          if (deleteTarget?._type === 'debt') return handleDeleteDebt(deleteTarget);
          return handleDeleteVariable(deleteTarget);
        }}
        loading={deleting || saving}
        title={deleteTarget?._type === 'fixed' ? 'Remover despesa fixa' : deleteTarget?._type === 'debt' ? 'Remover dívida' : 'Excluir despesa'}
        description={
          deleteTarget?._type === 'fixed'
            ? `A despesa "${deleteTarget?.description}" será removida agora deste mês e não será mais gerada nos próximos. O histórico passado permanece.`
            : deleteTarget?._type === 'debt'
            ? `A dívida "${deleteTarget?.description}" será encerrada: a parcela deste mês (se não pago) será removida agora e não haverá novas parcelas. Parcelas já pagas permanecem no histórico.`
            : `Excluir "${deleteTarget?.description}"? Esta ação não pode ser desfeita.`
        }
        confirmLabel="Confirmar" />
    </div>
  );
}