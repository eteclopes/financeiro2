import { useRef, useState } from 'react';
import { useMonthStore } from '../../store/monthStore';
import { incomesApi, expensesApi, debtsApi, cardsApi, goalsApi, categoriesApi } from '../../lib/services';
import { api, extractErrorMessage } from '../../lib/api';
import { formatCurrency } from '../../lib/format';
import { localDateInputValue } from '../../lib/date';
import { Button } from '../ui/index';
import { ChoiceCards, ToggleSwitch } from '../ui/Motion';
import { Modal, FormGroup, Input, Select } from '../ui/Modal';
import { CategorySelect } from '../ui/CategorySelect';
import { useUIStore } from '../../store/uiStore';
import { IconIncome, IconExpense, IconCheck, IconCard, IconGoal, IconAlert } from '../icons';

const PAYMENT_OPTIONS = [
  { value: 'pix', label: 'PIX', icon: '⚡', description: 'Instantâneo', tone: 'choice-card-icon-primary' },
  { value: 'debit', label: 'Débito', icon: '▣', description: 'Sai da conta', tone: 'choice-card-icon-info' },
  { value: 'credit', label: 'Crédito', icon: '◇', description: 'Vai para a fatura', tone: 'choice-card-icon-warning' },
  { value: 'cash', label: 'Dinheiro', icon: '●', description: 'Valor físico', tone: 'choice-card-icon-success' },
  { value: 'transfer', label: 'Transferência', icon: '⇄', description: 'TED ou banco', tone: 'choice-card-icon-primary' },
];

const RECEIPT_OPTIONS = PAYMENT_OPTIONS.filter((option) => option.value !== 'credit').map((option) => ({
  ...option,
  description: option.value === 'cash' ? 'Dinheiro em mãos' : option.description,
}));

const ORIGIN_OPTIONS = [
  { value: 'digital', label: 'Digital', icon: '◉', description: 'Disponível na conta', tone: 'choice-card-icon-info' },
  { value: 'physical', label: 'Físico', icon: '●', description: 'Dinheiro em mãos', tone: 'choice-card-icon-warning' },
];

const EXPENSE_KIND_OPTIONS = [
  { value: 'variable', label: 'Variável', icon: '↗', description: 'Compra ou gasto avulso', tone: 'choice-card-icon-primary' },
  { value: 'fixed', label: 'Fixa', icon: '↻', description: 'Repete todo mês', tone: 'choice-card-icon-info' },
  { value: 'debt', label: 'Dívida', icon: '≋', description: 'Parcelamento ou financiamento', tone: 'choice-card-icon-warning' },
];

const today = () => localDateInputValue();
const createIncomeForm = () => ({
  description: '', value: '', categoryId: '', paymentMethod: 'pix',
  origin: 'digital', date: today(), observation: '', recurring: false,
});
const createVariableForm = () => ({
  description: '', value: '', categoryId: '', date: today(),
  paymentMethod: 'pix', paid: true, cardId: '', observation: '',
});
const createFixedForm = () => ({
  description: '', value: '', categoryId: '', dueDay: '10',
  paymentMethod: 'transfer', cardId: '', observation: '',
});
const createDebtForm = () => ({
  description: '', categoryId: '', totalValue: '', installmentsCount: '1',
  flexiblePayment: false, dueDay: '10', startingInstallment: '1',
});

function defaultCategoryId(categories = []) {
  const preferred = categories.find((category) => category.name === 'Outros') ?? categories[0];
  return preferred ? String(preferred.id) : '';
}

export function QuickActions({ onRefresh, pendingExpenses = [], cards = [], goals = [], monthStatus }) {
  const selectedMonthId = useMonthStore((s) => s.selectedMonthId);
  const refreshMonths   = useMonthStore((s) => s.refreshMonths);
  const selectMonth     = useMonthStore((s) => s.selectMonth);
  const toast           = useUIStore((s) => s);

  const [modal, setModal]   = useState(null);
  const [saving, setSaving] = useState(false);

  const [incForm, setIncForm] = useState(createIncomeForm);
  const [incCats, setIncCats] = useState([]);
  const [loadingIncCats, setLoadingIncCats] = useState(false);

  const [expenseKind, setExpenseKind] = useState('variable');
  const [expForm, setExpForm] = useState(createVariableForm);
  const [fixForm, setFixForm] = useState(createFixedForm);
  const [debtForm, setDebtForm] = useState(createDebtForm);
  const [expCats, setExpCats] = useState([]);
  const [loadingExpCats, setLoadingExpCats] = useState(false);

  const [payTarget, setPayTarget] = useState(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('pix');

  const [invoices, setInvoices] = useState([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const invoiceRequestId = useRef(0);
  const [invoiceTarget, setInvoiceTarget] = useState(null);
  const [invMethod, setInvMethod] = useState('pix');

  const [goalTarget, setGoalTarget] = useState(null);
  const [contribForm, setContribForm] = useState({ value: '', date: today() });

  const [preview, setPreview] = useState(null);
  const [closing, setClosing] = useState(false);

  const activeCards = cards.filter((card) => card.active !== false);
  const activeGoals = goals.filter((goal) => !goal.status || goal.status === 'active');

  function openIncome() {
    const nextForm = createIncomeForm();
    if (incCats.length > 0) nextForm.categoryId = defaultCategoryId(incCats);

    // O modal abre primeiro; a rede nunca bloqueia a resposta visual do clique.
    setIncForm(nextForm);
    setModal('income');

    if (incCats.length > 0 || loadingIncCats) return;
    setLoadingIncCats(true);
    categoriesApi.list('income')
      .then((response) => {
        const categories = response.data.categories ?? [];
        setIncCats(categories);
        const categoryId = defaultCategoryId(categories);
        if (categoryId) {
          setIncForm((current) => current.categoryId ? current : { ...current, categoryId });
        }
      })
      .catch(() => setIncCats([]))
      .finally(() => setLoadingIncCats(false));
  }

  function openExpense() {
    const variable = createVariableForm();
    const fixed = createFixedForm();
    const debt = createDebtForm();
    const cachedCategoryId = defaultCategoryId(expCats);
    if (cachedCategoryId) {
      variable.categoryId = cachedCategoryId;
      fixed.categoryId = cachedCategoryId;
      debt.categoryId = cachedCategoryId;
    }

    // Mantém a abertura instantânea e preenche as categorias assim que chegarem.
    setExpenseKind('variable');
    setExpForm(variable);
    setFixForm(fixed);
    setDebtForm(debt);
    setModal('expense');

    if (expCats.length > 0 || loadingExpCats) return;
    setLoadingExpCats(true);
    categoriesApi.list('expense')
      .then((response) => {
        const categories = response.data.categories ?? [];
        setExpCats(categories);
        const categoryId = defaultCategoryId(categories);
        if (!categoryId) return;
        setExpForm((current) => current.categoryId ? current : { ...current, categoryId });
        setFixForm((current) => current.categoryId ? current : { ...current, categoryId });
        setDebtForm((current) => current.categoryId ? current : { ...current, categoryId });
      })
      .catch(() => setExpCats([]))
      .finally(() => setLoadingExpCats(false));
  }

  function openFatura() {
    const requestId = ++invoiceRequestId.current;
    setInvoices([]);
    setInvoiceTarget(null);
    setInvMethod('pix');
    setLoadingInvoices(true);
    setModal('fatura');

    // As faturas de todos os cartões são buscadas em paralelo. Antes, cada
    // cartão esperava o anterior terminar, multiplicando o atraso percebido.
    Promise.allSettled(cards.map(async (card) => {
      const response = await cardsApi.listInvoices(card.id);
      return (response.data.invoices ?? [])
        .filter((invoice) => invoice.status !== 'paid')
        .map((invoice) => ({ ...invoice, cardName: card.name }));
    }))
      .then((results) => {
        if (requestId !== invoiceRequestId.current) return;
        const all = results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
        setInvoices(all);
      })
      .finally(() => {
        if (requestId === invoiceRequestId.current) setLoadingInvoices(false);
      });
  }

  async function openClose() {
    setPreview(null);
    setModal('close');
    try {
      const response = await api.get(`/months/${selectedMonthId}/closing-preview`);
      setPreview(response.data);
    } catch {
      toast.error('Erro ao carregar pré-visualização.');
    }
  }

  async function saveIncome() {
    if (!incForm.description || !incForm.value || !incForm.categoryId) {
      toast.error('Preencha descrição, valor e categoria.');
      return;
    }
    if (Number(incForm.value) <= 0) {
      toast.error('Informe um valor maior que zero.');
      return;
    }

    setSaving(true);
    try {
      await incomesApi.create({
        ...incForm,
        monthId: selectedMonthId,
        value: parseFloat(incForm.value),
        categoryId: String(incForm.categoryId),
      });
      toast.success(incForm.recurring ? 'Receita recorrente adicionada.' : 'Receita adicionada.');
      setModal(null);
      onRefresh?.();
    } catch (error) {
      toast.error(extractErrorMessage(error, 'Erro ao salvar.'));
    } finally {
      setSaving(false);
    }
  }

  async function saveVariableExpense() {
    if (!expForm.description || !expForm.value || !expForm.categoryId) {
      toast.error('Preencha descrição, valor e categoria.');
      return false;
    }
    if (Number(expForm.value) <= 0) {
      toast.error('Informe um valor maior que zero.');
      return false;
    }
    if (expForm.paymentMethod === 'credit' && !expForm.cardId) {
      toast.error('Selecione o cartão de crédito.');
      return false;
    }

    const { cardId, ...rest } = expForm;
    await expensesApi.createVariable({
      ...rest,
      monthId: selectedMonthId,
      value: parseFloat(expForm.value),
      categoryId: String(expForm.categoryId),
      ...(expForm.paymentMethod === 'credit' ? { cardId } : {}),
    });
    toast.success('Despesa variável adicionada.');
    return true;
  }

  async function saveFixedExpense() {
    if (!fixForm.description || !fixForm.value || !fixForm.categoryId) {
      toast.error('Preencha descrição, valor e categoria.');
      return false;
    }
    if (Number(fixForm.value) <= 0 || Number(fixForm.dueDay) < 1 || Number(fixForm.dueDay) > 31) {
      toast.error('Informe um valor válido e um vencimento entre 1 e 31.');
      return false;
    }
    if (fixForm.paymentMethod === 'credit' && !fixForm.cardId) {
      toast.error('Selecione o cartão de crédito.');
      return false;
    }

    const { cardId, ...rest } = fixForm;
    await expensesApi.createFixed({
      ...rest,
      monthId: selectedMonthId,
      value: parseFloat(fixForm.value),
      dueDay: parseInt(fixForm.dueDay, 10),
      categoryId: String(fixForm.categoryId),
      ...(fixForm.paymentMethod === 'credit' ? { cardId } : {}),
    });
    toast.success('Despesa fixa adicionada.');
    return true;
  }

  async function saveDebtExpense() {
    const installments = parseInt(debtForm.installmentsCount, 10);
    const startingInstallment = parseInt(debtForm.startingInstallment, 10) || 1;
    const dueDay = parseInt(debtForm.dueDay, 10);

    if (!debtForm.description || !debtForm.totalValue || !debtForm.categoryId) {
      toast.error('Preencha descrição, valor total e categoria.');
      return false;
    }
    if (Number(debtForm.totalValue) <= 0 || installments < 1 || installments > 360) {
      toast.error('Informe um valor e uma quantidade de parcelas válidos.');
      return false;
    }
    if (startingInstallment < 1 || startingInstallment > installments) {
      toast.error('A parcela inicial deve estar entre 1 e o total de parcelas.');
      return false;
    }
    if (dueDay < 1 || dueDay > 31) {
      toast.error('O dia de vencimento deve estar entre 1 e 31.');
      return false;
    }

    await debtsApi.create({
      ...debtForm,
      monthId: selectedMonthId,
      totalValue: parseFloat(debtForm.totalValue),
      installmentsCount: installments,
      dueDay,
      startingInstallment,
      categoryId: String(debtForm.categoryId),
    });
    toast.success('Dívida adicionada.');
    return true;
  }

  async function saveExpense() {
    setSaving(true);
    try {
      const saved = expenseKind === 'fixed'
        ? await saveFixedExpense()
        : expenseKind === 'debt'
          ? await saveDebtExpense()
          : await saveVariableExpense();

      if (!saved) return;
      setModal(null);
      onRefresh?.();
    } catch (error) {
      toast.error(extractErrorMessage(error, 'Erro ao salvar despesa.'));
    } finally {
      setSaving(false);
    }
  }

  async function payExpense() {
    if (!payTarget || !payAmount) {
      toast.error('Selecione a conta e informe o valor.');
      return;
    }
    if (Number(payAmount) <= 0) {
      toast.error('Informe um valor maior que zero.');
      return;
    }

    setSaving(true);
    try {
      await expensesApi.pay(payTarget.id, { amount: parseFloat(payAmount), paymentMethod: payMethod });
      toast.success('Pagamento registrado.');
      setModal(null);
      onRefresh?.();
    } catch (error) {
      toast.error(extractErrorMessage(error, 'Erro ao pagar.'));
    } finally {
      setSaving(false);
    }
  }

  async function payInvoice() {
    if (!invoiceTarget) {
      toast.error('Selecione uma fatura.');
      return;
    }

    setSaving(true);
    try {
      await cardsApi.payInvoice(invoiceTarget.id, { paymentMethod: invMethod });
      toast.success('Fatura paga com sucesso.');
      setModal(null);
      onRefresh?.();
    } catch (error) {
      toast.error(extractErrorMessage(error, 'Erro ao pagar fatura.'));
    } finally {
      setSaving(false);
    }
  }

  async function saveContrib() {
    if (!goalTarget || !contribForm.value) {
      toast.error('Selecione uma meta e informe o valor.');
      return;
    }
    if (Number(contribForm.value) <= 0) {
      toast.error('Informe um valor maior que zero.');
      return;
    }

    setSaving(true);
    try {
      await goalsApi.contribute(goalTarget.id, {
        value: parseFloat(contribForm.value),
        date: contribForm.date,
        monthId: selectedMonthId,
      });
      toast.success('Aporte registrado.');
      setModal(null);
      onRefresh?.();
    } catch (error) {
      toast.error(extractErrorMessage(error, 'Erro ao aportar.'));
    } finally {
      setSaving(false);
    }
  }

  async function closeMonth() {
    setClosing(true);
    try {
      const { data } = await api.post(`/months/${selectedMonthId}/close`);
      toast.success('Mês encerrado com sucesso!');
      setModal(null);
      await refreshMonths();
      if (data?.nextMonth?.id) selectMonth(data.nextMonth.id);
    } catch (error) {
      toast.error(extractErrorMessage(error, 'Erro ao encerrar mês.'));
    } finally {
      setClosing(false);
    }
  }

  const ACTIONS = [
    { Icon: IconIncome, label: 'Receita', iconBg: 'bg-primary-muted dark:bg-primary/20', iconColor: 'text-primary-dark dark:text-primary-light', onClick: openIncome },
    { Icon: IconExpense, label: 'Despesa', iconBg: 'bg-danger-muted dark:bg-danger/20', iconColor: 'text-danger-dark dark:text-danger-light', onClick: openExpense },
    { Icon: IconCheck, label: 'Pagar conta', iconBg: 'bg-info-muted dark:bg-info/20', iconColor: 'text-info-dark dark:text-info-light', onClick: () => { setPayTarget(null); setPayAmount(''); setPayMethod('pix'); setModal('pay'); } },
    { Icon: IconCard, label: 'Fatura', iconBg: 'bg-warning-muted dark:bg-warning/20', iconColor: 'text-warning-dark dark:text-warning-light', onClick: openFatura },
    { Icon: IconGoal, label: 'Meta', iconBg: 'bg-purple-100 dark:bg-accentpurple/20', iconColor: 'text-purple-700 dark:text-accentpurple-light', onClick: () => { setGoalTarget(null); setContribForm({ value: '', date: today() }); setModal('goal'); } },
    ...(monthStatus === 'open'
      ? [{ Icon: IconAlert, label: 'Fechar mês', iconBg: 'bg-gray-100 dark:bg-white/10', iconColor: 'text-gray-600 dark:text-zinc-300', onClick: openClose }]
      : []
    ),
  ];

  const expenseSaveLabel = expenseKind === 'fixed'
    ? 'Criar Despesa Fixa'
    : expenseKind === 'debt'
      ? 'Criar Dívida'
      : 'Salvar Despesa';

  const monthlyInstallment = debtForm.totalValue && Number(debtForm.installmentsCount) > 0
    ? Number(debtForm.totalValue) / Number(debtForm.installmentsCount)
    : 0;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {ACTIONS.map(({ Icon, label, iconBg, iconColor, onClick }) => (
          <button
            type="button"
            key={label}
            onClick={onClick}
            className="quick-action-card group flex items-center gap-2.5 border border-slate-200 bg-white px-3 py-2.5 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 hover:shadow-[0_18px_34px_-22px_rgb(124_58_237_/_0.65)] active:translate-y-0 active:scale-[0.98] dark:border-white/[0.07] dark:bg-white/[0.035] dark:hover:border-primary/35"
          >
            <span className={`quick-action-icon h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${iconBg} ${iconColor}`}>
              <Icon size={15} strokeWidth={2} />
            </span>
            <span className="text-xs font-bold text-slate-700 dark:text-zinc-200">{label}</span>
          </button>
        ))}
      </div>

      {/* ── Nova Receita completa ── */}
      <Modal open={modal === 'income'} onClose={() => setModal(null)} title="Nova Receita" size="md">
        <div className="space-y-4">
          <FormGroup label="Descrição" required>
            <Input value={incForm.description} onChange={(event) => setIncForm({ ...incForm, description: event.target.value })} placeholder="Ex: Salário, Freelance..." />
          </FormGroup>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormGroup label="Valor" required>
              <Input type="number" min="0" step="0.01" value={incForm.value} onChange={(event) => setIncForm({ ...incForm, value: event.target.value })} placeholder="0,00" />
            </FormGroup>
            <FormGroup label="Data" required>
              <Input type="date" value={incForm.date} onChange={(event) => setIncForm({ ...incForm, date: event.target.value })} />
            </FormGroup>
          </div>
          <FormGroup label="Categoria" required>
            <CategorySelect
              key="income-category"
              value={incForm.categoryId}
              onChange={(event) => setIncForm({ ...incForm, categoryId: event.target.value })}
              categories={incCats}
              type="income"
              onCategoryCreated={(category) => setIncCats((current) => [...current, category])}
              placeholder={loadingIncCats ? 'Carregando categorias...' : 'Selecione...'}
            />
            {loadingIncCats && <p className="mt-1.5 text-xs text-muted">Carregando categorias sem bloquear o formulário...</p>}
          </FormGroup>
          <FormGroup label="Forma de recebimento">
            <ChoiceCards
              compact
              columns={4}
              value={incForm.paymentMethod}
              onChange={(paymentMethod) => setIncForm({
                ...incForm,
                paymentMethod,
                origin: paymentMethod === 'cash' ? 'physical' : incForm.origin,
              })}
              options={RECEIPT_OPTIONS}
            />
          </FormGroup>
          <FormGroup label="Origem do dinheiro">
            <ChoiceCards compact columns={2} value={incForm.origin} onChange={(origin) => setIncForm({ ...incForm, origin })} options={ORIGIN_OPTIONS} />
          </FormGroup>
          <FormGroup label="Observação">
            <Input value={incForm.observation} onChange={(event) => setIncForm({ ...incForm, observation: event.target.value })} placeholder="Opcional" />
          </FormGroup>
          <ToggleSwitch
            checked={incForm.recurring}
            onChange={(recurring) => setIncForm({ ...incForm, recurring })}
            label="Receita recorrente"
            description="Será gerada automaticamente todo mês ao fechar o período."
          />
          <div className="modal-actions">
            <Button variant="outline" onClick={() => setModal(null)}>Cancelar</Button>
            <Button onClick={saveIncome} loading={saving}>Salvar Receita</Button>
          </div>
        </div>
      </Modal>

      {/* ── Nova Despesa completa ── */}
      <Modal open={modal === 'expense'} onClose={() => setModal(null)} title="Nova Despesa" size="lg">
        <div className="space-y-4">
          <FormGroup label="Tipo de despesa">
            <ChoiceCards compact columns={3} value={expenseKind} onChange={setExpenseKind} options={EXPENSE_KIND_OPTIONS} />
          </FormGroup>

          {expenseKind === 'variable' && (
            <>
              <FormGroup label="Descrição" required>
                <Input value={expForm.description} onChange={(event) => setExpForm({ ...expForm, description: event.target.value })} placeholder="Ex: Mercado, Lanche..." />
              </FormGroup>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormGroup label="Valor" required>
                  <Input type="number" min="0" step="0.01" value={expForm.value} onChange={(event) => setExpForm({ ...expForm, value: event.target.value })} />
                </FormGroup>
                <FormGroup label="Data" required>
                  <Input type="date" value={expForm.date} onChange={(event) => setExpForm({ ...expForm, date: event.target.value })} />
                </FormGroup>
              </div>
              <FormGroup label="Categoria" required>
                <CategorySelect
                  key="variable-category"
                  value={expForm.categoryId}
                  onChange={(event) => setExpForm({ ...expForm, categoryId: event.target.value })}
                  categories={expCats}
                  type="expense"
                  onCategoryCreated={(category) => setExpCats((current) => [...current, category])}
                  placeholder={loadingExpCats ? 'Carregando categorias...' : 'Selecione...'}
                />
                {loadingExpCats && <p className="mt-1.5 text-xs text-muted">Carregando categorias sem bloquear o formulário...</p>}
              </FormGroup>
              <FormGroup label="Forma de pagamento">
                <ChoiceCards
                  compact
                  value={expForm.paymentMethod}
                  onChange={(paymentMethod) => setExpForm({
                    ...expForm,
                    paymentMethod,
                    cardId: paymentMethod === 'credit' ? expForm.cardId : '',
                    paid: paymentMethod === 'credit' ? true : expForm.paid,
                  })}
                  options={PAYMENT_OPTIONS}
                />
              </FormGroup>
              {expForm.paymentMethod === 'credit' && (
                <FormGroup label="Cartão" required>
                  {activeCards.length === 0 ? (
                    <p className="text-xs text-warning-dark bg-warning-subtle p-2.5 rounded-lg border border-warning/20">
                      Você ainda não tem nenhum cartão ativo cadastrado.
                    </p>
                  ) : (
                    <Select value={expForm.cardId} onChange={(event) => setExpForm({ ...expForm, cardId: event.target.value })}>
                      <option value="">Selecione...</option>
                      {activeCards.map((card) => (
                        <option key={card.id} value={card.id}>{card.name} — disponível {formatCurrency(card.availableLimit)}</option>
                      ))}
                    </Select>
                  )}
                  <p className="text-xs text-muted mt-1.5">A compra entra na fatura e reduz o limite disponível imediatamente.</p>
                </FormGroup>
              )}
              {expForm.paymentMethod !== 'credit' && (
                <ToggleSwitch
                  checked={expForm.paid}
                  onChange={(paid) => setExpForm({ ...expForm, paid })}
                  label="Já foi pago"
                  description="Desative para deixar a despesa pendente neste mês."
                />
              )}
              <FormGroup label="Observação" hint="opcional">
                <Input value={expForm.observation} onChange={(event) => setExpForm({ ...expForm, observation: event.target.value })} placeholder="Ex: detalhes do gasto" />
              </FormGroup>
            </>
          )}

          {expenseKind === 'fixed' && (
            <>
              <p className="text-xs bg-info-subtle text-info-dark p-3 rounded-xl border border-info/20">
                ℹ Despesas fixas são geradas automaticamente todo mês ao fechar o período.
              </p>
              <FormGroup label="Descrição" required>
                <Input value={fixForm.description} onChange={(event) => setFixForm({ ...fixForm, description: event.target.value })} placeholder="Ex: Academia, Internet..." />
              </FormGroup>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormGroup label="Valor mensal" required>
                  <Input type="number" min="0" step="0.01" value={fixForm.value} onChange={(event) => setFixForm({ ...fixForm, value: event.target.value })} />
                </FormGroup>
                <FormGroup label="Dia de vencimento" required>
                  <Input type="number" min="1" max="31" value={fixForm.dueDay} onChange={(event) => setFixForm({ ...fixForm, dueDay: event.target.value })} />
                </FormGroup>
              </div>
              <FormGroup label="Categoria" required>
                <CategorySelect
                  key="fixed-category"
                  value={fixForm.categoryId}
                  onChange={(event) => setFixForm({ ...fixForm, categoryId: event.target.value })}
                  categories={expCats}
                  type="expense"
                  onCategoryCreated={(category) => setExpCats((current) => [...current, category])}
                  placeholder={loadingExpCats ? 'Carregando categorias...' : 'Selecione...'}
                />
                {loadingExpCats && <p className="mt-1.5 text-xs text-muted">Carregando categorias sem bloquear o formulário...</p>}
              </FormGroup>
              <FormGroup label="Forma de pagamento" required>
                <ChoiceCards
                  compact
                  value={fixForm.paymentMethod}
                  onChange={(paymentMethod) => setFixForm({
                    ...fixForm,
                    paymentMethod,
                    cardId: paymentMethod === 'credit' ? fixForm.cardId : '',
                  })}
                  options={PAYMENT_OPTIONS}
                />
              </FormGroup>
              {fixForm.paymentMethod === 'credit' && (
                <FormGroup label="Cartão" required>
                  {activeCards.length === 0 ? (
                    <p className="text-xs text-warning-dark bg-warning-subtle p-2.5 rounded-lg border border-warning/20">
                      Você ainda não tem nenhum cartão ativo cadastrado.
                    </p>
                  ) : (
                    <Select value={fixForm.cardId} onChange={(event) => setFixForm({ ...fixForm, cardId: event.target.value })}>
                      <option value="">Selecione...</option>
                      {activeCards.map((card) => <option key={card.id} value={card.id}>{card.name}</option>)}
                    </Select>
                  )}
                  <p className="text-xs text-muted mt-1.5">
                    Será lançada na fatura todo mês e não descontará do saldo até a fatura ser paga.
                  </p>
                </FormGroup>
              )}
              <FormGroup label="Observação" hint="opcional">
                <Input value={fixForm.observation} onChange={(event) => setFixForm({ ...fixForm, observation: event.target.value })} placeholder="Ex: reajuste anual em janeiro" />
              </FormGroup>
            </>
          )}

          {expenseKind === 'debt' && (
            <>
              <FormGroup label="Descrição" required>
                <Input value={debtForm.description} onChange={(event) => setDebtForm({ ...debtForm, description: event.target.value })} placeholder="Ex: Empréstimo, Financiamento..." />
              </FormGroup>
              <FormGroup label="Categoria" required>
                <CategorySelect
                  key="debt-category"
                  value={debtForm.categoryId}
                  onChange={(event) => setDebtForm({ ...debtForm, categoryId: event.target.value })}
                  categories={expCats}
                  type="expense"
                  onCategoryCreated={(category) => setExpCats((current) => [...current, category])}
                  placeholder={loadingExpCats ? 'Carregando categorias...' : 'Selecione...'}
                />
                {loadingExpCats && <p className="mt-1.5 text-xs text-muted">Carregando categorias sem bloquear o formulário...</p>}
              </FormGroup>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <FormGroup label="Valor total" required>
                  <Input type="number" min="0" step="0.01" value={debtForm.totalValue} onChange={(event) => setDebtForm({ ...debtForm, totalValue: event.target.value })} />
                </FormGroup>
                <FormGroup label="Nº de parcelas" required>
                  <Input type="number" min="1" max="360" value={debtForm.installmentsCount} onChange={(event) => setDebtForm({ ...debtForm, installmentsCount: event.target.value })} />
                </FormGroup>
                <FormGroup label="Dia venc." required>
                  <Input type="number" min="1" max="31" value={debtForm.dueDay} onChange={(event) => setDebtForm({ ...debtForm, dueDay: event.target.value })} />
                </FormGroup>
              </div>
              {monthlyInstallment > 0 && (
                <div className="bg-primary-subtle border border-primary/20 rounded-xl p-3 text-sm">
                  <span className="text-primary-dark font-medium">Parcela mensal: </span>
                  <span className="font-mono font-bold text-primary-dark">{formatCurrency(monthlyInstallment)}</span>
                </div>
              )}
              <FormGroup label="Essa compra já está em andamento?">
                <Input
                  type="number"
                  min="1"
                  max={debtForm.installmentsCount || 360}
                  value={debtForm.startingInstallment}
                  onChange={(event) => setDebtForm({ ...debtForm, startingInstallment: event.target.value })}
                />
                <p className="text-xs text-muted mt-1.5">
                  Deixe em 1 se está começando agora. Caso já tenha pago parcelas fora do app, informe qual é a próxima.
                </p>
              </FormGroup>
              <ToggleSwitch
                checked={debtForm.flexiblePayment}
                onChange={(flexiblePayment) => setDebtForm({ ...debtForm, flexiblePayment })}
                label="Aceitar pagamento parcial"
                description="O valor não pago será somado à próxima parcela."
              />
            </>
          )}

          <div className="modal-actions">
            <Button variant="outline" onClick={() => setModal(null)}>Cancelar</Button>
            <Button onClick={saveExpense} loading={saving}>{expenseSaveLabel}</Button>
          </div>
        </div>
      </Modal>

      {/* ── Pagar Conta ── */}
      <Modal open={modal === 'pay'} onClose={() => setModal(null)} title="Pagar Conta" size="sm">
        <div className="space-y-4">
          {pendingExpenses.length === 0 ? (
            <p className="text-sm text-muted text-center py-4">Nenhuma conta pendente neste mês.</p>
          ) : (
            <>
              <FormGroup label="Conta a pagar">
                <Select value={payTarget?.id ?? ''} onChange={(event) => {
                  const expense = pendingExpenses.find((item) => String(item.id) === event.target.value);
                  setPayTarget(expense ?? null);
                  setPayAmount(String(expense?.value ?? ''));
                }}>
                  <option value="">Selecione...</option>
                  {pendingExpenses.map((expense) => (
                    <option key={expense.id} value={expense.id}>{expense.description} — {formatCurrency(expense.value)}</option>
                  ))}
                </Select>
              </FormGroup>
              {payTarget && (
                <div className="bg-subtle dark:bg-white/[0.04] rounded-xl p-3 text-sm">
                  <p className="font-semibold text-slate-900 dark:text-zinc-50">{payTarget.description}</p>
                  <p className="mt-1 text-xs text-muted">Valor previsto: {formatCurrency(payTarget.value)}</p>
                </div>
              )}
              <FormGroup label="Valor pago" required>
                <Input type="number" min="0" step="0.01" value={payAmount} onChange={(event) => setPayAmount(event.target.value)} />
              </FormGroup>
              <FormGroup label="Forma de pagamento">
                <ChoiceCards compact columns={2} value={payMethod} onChange={setPayMethod} options={PAYMENT_OPTIONS.filter((option) => option.value !== 'credit')} />
              </FormGroup>
              {payTarget?.type === 'priority' && (
                <p className="text-xs text-info bg-info-subtle p-3 rounded-xl border border-info/20">
                  💡 Em dívidas flexíveis, o saldo não pago será acumulado para a próxima parcela.
                </p>
              )}
              <div className="modal-actions">
                <Button variant="outline" onClick={() => setModal(null)}>Cancelar</Button>
                <Button onClick={payExpense} loading={saving}>Confirmar Pagamento</Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* ── Pagar Fatura ── */}
      <Modal open={modal === 'fatura'} onClose={() => setModal(null)} title="Pagar Fatura do Cartão" size="sm">
        <div className="space-y-4">
          {loadingInvoices ? (
            <div className="py-5 text-center" aria-live="polite">
              <p className="text-sm font-medium text-slate-700 dark:text-zinc-200">Buscando faturas...</p>
              <p className="mt-1 text-xs text-muted">O formulário abriu imediatamente; os cartões estão sendo consultados em paralelo.</p>
            </div>
          ) : invoices.length === 0 ? (
            <p className="text-sm text-muted text-center py-4">Nenhuma fatura em aberto.</p>
          ) : (
            <>
              <FormGroup label="Fatura">
                <Select
                  value={invoiceTarget?.id ?? ''}
                  onChange={(event) => setInvoiceTarget(invoices.find((invoice) => String(invoice.id) === event.target.value) ?? null)}
                >
                  <option value="">Selecione...</option>
                  {invoices.map((invoice) => (
                    <option key={invoice.id} value={invoice.id}>
                      {invoice.cardName} — {String(invoice.referenceMonth).padStart(2, '0')}/{invoice.referenceYear} — {formatCurrency(invoice.totalValue)}
                    </option>
                  ))}
                </Select>
              </FormGroup>
              {invoiceTarget && (
                <div className="bg-subtle dark:bg-white/[0.04] rounded-2xl p-4">
                  <p className="text-xs text-muted mb-1">Valor total da fatura</p>
                  <p className="text-2xl font-bold font-mono text-slate-900 dark:text-zinc-50">{formatCurrency(invoiceTarget.totalValue)}</p>
                  <p className="text-xs text-muted mt-1">{String(invoiceTarget.referenceMonth).padStart(2, '0')}/{invoiceTarget.referenceYear}</p>
                </div>
              )}
              <FormGroup label="Forma de pagamento">
                <ChoiceCards compact columns={2} value={invMethod} onChange={setInvMethod} options={PAYMENT_OPTIONS.filter((option) => option.value !== 'credit')} />
              </FormGroup>
              <div className="modal-actions">
                <Button variant="outline" onClick={() => setModal(null)}>Cancelar</Button>
                <Button onClick={payInvoice} loading={saving}>Pagar Fatura</Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* ── Aporte em Meta ── */}
      <Modal open={modal === 'goal'} onClose={() => setModal(null)} title="Aporte em Meta" size="sm">
        <div className="space-y-4">
          {activeGoals.length === 0 ? (
            <p className="text-sm text-muted text-center py-4">Nenhuma meta ativa.</p>
          ) : (
            <>
              <FormGroup label="Meta">
                <Select
                  value={goalTarget?.id ?? ''}
                  onChange={(event) => setGoalTarget(activeGoals.find((goal) => String(goal.id) === event.target.value) ?? null)}
                >
                  <option value="">Selecione...</option>
                  {activeGoals.map((goal) => (
                    <option key={goal.id} value={goal.id}>{goal.name} — faltam {formatCurrency(goal.remaining ?? 0)}</option>
                  ))}
                </Select>
              </FormGroup>
              {goalTarget && (
                <div className="bg-primary-subtle border border-primary/20 rounded-xl p-3 text-sm">
                  <span className="text-primary-dark">Faltam </span>
                  <span className="font-bold text-primary-dark">{formatCurrency(goalTarget.remaining ?? 0)}</span>
                  <span className="text-primary-dark"> para atingir a meta</span>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormGroup label="Valor do aporte" required>
                  <Input type="number" min="0" step="0.01" value={contribForm.value} onChange={(event) => setContribForm({ ...contribForm, value: event.target.value })} placeholder="R$ 0,00" />
                </FormGroup>
                <FormGroup label="Data">
                  <Input type="date" value={contribForm.date} onChange={(event) => setContribForm({ ...contribForm, date: event.target.value })} />
                </FormGroup>
              </div>
              <p className="text-xs text-muted bg-subtle dark:bg-white/[0.04] p-3 rounded-xl">
                O valor será descontado do saldo atual do mês selecionado.
              </p>
              <div className="modal-actions">
                <Button variant="outline" onClick={() => setModal(null)}>Cancelar</Button>
                <Button onClick={saveContrib} loading={saving}>Confirmar Aporte</Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* ── Fechar Mês ── */}
      <Modal open={modal === 'close'} onClose={() => setModal(null)} title="Fechar Mês" size="sm">
        <div className="space-y-4">
          {!preview ? (
            <p className="text-sm text-muted">Carregando resumo...</p>
          ) : (
            <div className="bg-subtle dark:bg-white/[0.04] rounded-xl p-3 text-xs space-y-1.5">
              {[
                ['Contas pendentes', preview.pendingExpensesCount],
                ['Faturas em aberto', preview.openInvoicesCount],
                ['Receitas a gerar', preview.willGenerateNextMonth?.recurringIncomes],
                ['Despesas fixas a gerar', preview.willGenerateNextMonth?.fixedExpenses],
                ['Parcelas de dívida', preview.willGenerateNextMonth?.debtInstallments],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between">
                  <span className="text-muted">{label}</span>
                  <span className="font-mono font-semibold text-slate-800 dark:text-zinc-200">{value ?? 0}</span>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-muted">Pendências não pagas permanecem no histórico — nada é perdido ou duplicado.</p>
          <div className="modal-actions">
            <Button variant="outline" onClick={() => setModal(null)}>Cancelar</Button>
            <Button variant="danger" onClick={closeMonth} loading={closing} disabled={!preview}>Encerrar Mês</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
