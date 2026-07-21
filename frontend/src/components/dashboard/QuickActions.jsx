import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMonthStore } from '../../store/monthStore';
import { incomesApi, expensesApi, cardsApi, goalsApi, categoriesApi } from '../../lib/services';
import { api, extractErrorMessage } from '../../lib/api';
import { formatCurrency } from '../../lib/format';
import { localDateInputValue } from '../../lib/date';
import { Button } from '../ui/index';
import { Modal, FormGroup, Input, Select } from '../ui/Modal';
import { useUIStore } from '../../store/uiStore';
import { IconIncome, IconExpense, IconCheck, IconCard, IconGoal, IconAlert } from '../icons';

const PM_LABELS = { cash: 'Dinheiro', pix: 'PIX', debit: 'Débito', credit: 'Crédito', transfer: 'Transferência' };
const today = () => localDateInputValue();

export function QuickActions({ onRefresh, pendingExpenses = [], cards = [], goals = [], monthStatus }) {
  const selectedMonthId = useMonthStore((s) => s.selectedMonthId);
  const refreshMonths   = useMonthStore((s) => s.refreshMonths);
  const selectMonth     = useMonthStore((s) => s.selectMonth);
  const navigate        = useNavigate();
  const toast           = useUIStore((s) => s);

  const [modal, setModal]   = useState(null);
  const [saving, setSaving] = useState(false);

  const [incForm, setIncForm]   = useState({ description: '', value: '', paymentMethod: 'pix', date: today() });
  const [expForm, setExpForm]   = useState({ description: '', value: '', categoryId: '', paymentMethod: 'pix', cardId: '', date: today() });
  const [expCats, setExpCats]   = useState([]);
  const [payTarget, setPayTarget]   = useState(null);
  const [payAmount, setPayAmount]   = useState('');
  const [payMethod, setPayMethod]   = useState('pix');
  const [invoices, setInvoices]     = useState([]);
  const [invoiceTarget, setInvoiceTarget] = useState(null);
  const [invMethod, setInvMethod]   = useState('pix');
  const [goalTarget, setGoalTarget] = useState(null);
  const [contribValue, setContribValue] = useState('');
  const [preview, setPreview]     = useState(null);
  const [closing, setClosing]     = useState(false);

  async function openExpense() {
    try {
      const r = await categoriesApi.list('expense');
      setExpCats(r.data.categories ?? []);
    } catch {}
    setExpForm({ description: '', value: '', categoryId: '', paymentMethod: 'pix', cardId: '', date: today() });
    setModal('expense');
  }

  async function openFatura() {
    const all = [];
    for (const card of cards) {
      try {
        const r = await cardsApi.listInvoices(card.id);
        (r.data.invoices ?? [])
          .filter((i) => i.status !== 'paid')
          .forEach((inv) => all.push({ ...inv, cardName: card.name }));
      } catch {}
    }
    setInvoices(all);
    setInvoiceTarget(null);
    setInvMethod('pix');
    setModal('fatura');
  }

  async function openClose() {
    setPreview(null);
    setModal('close');
    try {
      const r = await api.get(`/months/${selectedMonthId}/closing-preview`);
      setPreview(r.data);
    } catch { toast.error('Erro ao carregar pré-visualização.'); }
  }

  async function saveIncome() {
    if (!incForm.description || !incForm.value) { toast.error('Preencha descrição e valor.'); return; }
    setSaving(true);
    try {
      const cats = await categoriesApi.list('income');
      const cat  = (cats.data.categories ?? []).find((c) => c.name === 'Outros') ?? cats.data.categories?.[0];
      await incomesApi.create({
        monthId: selectedMonthId,
        description: incForm.description,
        value: parseFloat(incForm.value),
        categoryId: String(cat?.id ?? ''),
        paymentMethod: incForm.paymentMethod,
        origin: incForm.paymentMethod === 'cash' ? 'physical' : 'digital',
        date: incForm.date,
        recurring: false,
      });
      toast.success('Receita adicionada.');
      setModal(null);
      onRefresh();
    } catch (e) { toast.error(extractErrorMessage(e, 'Erro ao salvar.')); }
    finally { setSaving(false); }
  }

  async function saveExpense() {
    if (!expForm.description || !expForm.value) { toast.error('Preencha descrição e valor.'); return; }
    if (expForm.paymentMethod === 'credit' && !expForm.cardId) {
      toast.error('Selecione o cartão de crédito.');
      return;
    }
    setSaving(true);
    try {
      const cats = await categoriesApi.list('expense');
      const cat  = expForm.categoryId
        ? { id: expForm.categoryId }
        : (cats.data.categories ?? []).find((c) => c.name === 'Outros') ?? cats.data.categories?.[0];
      await expensesApi.createVariable({
        monthId: selectedMonthId,
        description: expForm.description,
        value: parseFloat(expForm.value),
        categoryId: String(cat?.id ?? ''),
        date: expForm.date,
        paymentMethod: expForm.paymentMethod,
        cardId: expForm.paymentMethod === 'credit' ? expForm.cardId : undefined,
        paid: expForm.paymentMethod !== 'credit',
      });
      toast.success('Despesa adicionada.');
      setModal(null);
      onRefresh();
    } catch (e) { toast.error(extractErrorMessage(e, 'Erro ao salvar.')); }
    finally { setSaving(false); }
  }

  async function payExpense() {
    if (!payTarget || !payAmount) { toast.error('Selecione a conta e informe o valor.'); return; }
    setSaving(true);
    try {
      await expensesApi.pay(payTarget.id, { amount: parseFloat(payAmount), paymentMethod: payMethod });
      toast.success('Pagamento registrado.');
      setModal(null);
      onRefresh();
    } catch (e) { toast.error(extractErrorMessage(e, 'Erro ao pagar.')); }
    finally { setSaving(false); }
  }

  async function payInvoice() {
    if (!invoiceTarget) { toast.error('Selecione uma fatura.'); return; }
    setSaving(true);
    try {
      await cardsApi.payInvoice(invoiceTarget.id, { paymentMethod: invMethod });
      toast.success('Fatura paga com sucesso.');
      setModal(null);
      onRefresh();
    } catch (e) { toast.error(extractErrorMessage(e, 'Erro ao pagar fatura.')); }
    finally { setSaving(false); }
  }

  async function saveContrib() {
    if (!goalTarget || !contribValue) { toast.error('Selecione uma meta e informe o valor.'); return; }
    setSaving(true);
    try {
      await goalsApi.contribute(goalTarget.id, {
        value: parseFloat(contribValue),
        date: today(),
        monthId: selectedMonthId,
      });
      toast.success('Aporte registrado.');
      setModal(null);
      onRefresh();
    } catch (e) { toast.error(extractErrorMessage(e, 'Erro ao aportar.')); }
    finally { setSaving(false); }
  }

  async function closeMonth() {
    setClosing(true);
    try {
      const { data } = await api.post(`/months/${selectedMonthId}/close`);
      toast.success('Mês encerrado com sucesso!');
      setModal(null);
      // Atualiza a lista de meses (agora inclui o mês recém-criado) e
      // seleciona esse mês diretamente — ver o comentário de
      // `refreshMonths()` em monthStore.js para o porquê de não usar mais
      // `initialize()` aqui. Não chamamos `onRefresh()` depois: ele está
      // vinculado ao `selectedMonthId` de QUANDO ESTE COMPONENTE FOI
      // RENDERIZADO (o mês que acabou de fechar), então chamá-lo aqui
      // buscaria os dados do mês ERRADO por uma fração de segundo — a
      // troca de `selectedMonthId` abaixo já dispara sozinha o recarregamento
      // do dashboard para o mês novo, reativamente.
      await refreshMonths();
      if (data?.nextMonth?.id) selectMonth(data.nextMonth.id);
    } catch (e) { toast.error(extractErrorMessage(e, 'Erro ao encerrar mês.')); }
    finally { setClosing(false); }
  }

  const ACTIONS = [
    { Icon: IconIncome,  label: 'Receita',     iconBg: 'bg-primary-muted dark:bg-primary/20',   iconColor: 'text-primary-dark dark:text-primary-light',    onClick: () => { setIncForm({ description: '', value: '', paymentMethod: 'pix', date: today() }); setModal('income'); } },
    { Icon: IconExpense, label: 'Despesa',     iconBg: 'bg-danger-muted dark:bg-danger/20',     iconColor: 'text-danger-dark dark:text-danger-light',      onClick: openExpense },
    { Icon: IconCheck,   label: 'Pagar conta', iconBg: 'bg-info-muted dark:bg-info/20',         iconColor: 'text-info-dark dark:text-info-light',          onClick: () => { setPayTarget(null); setPayAmount(''); setPayMethod('pix'); setModal('pay'); } },
    { Icon: IconCard,    label: 'Fatura',      iconBg: 'bg-warning-muted dark:bg-warning/20',   iconColor: 'text-warning-dark dark:text-warning-light',    onClick: openFatura },
    { Icon: IconGoal,    label: 'Meta',        iconBg: 'bg-purple-100 dark:bg-accentpurple/20', iconColor: 'text-purple-700 dark:text-accentpurple-light', onClick: () => { setGoalTarget(null); setContribValue(''); setModal('goal'); } },
    ...(monthStatus === 'open'
      ? [{ Icon: IconAlert, label: 'Fechar mês', iconBg: 'bg-gray-100 dark:bg-white/10', iconColor: 'text-gray-600 dark:text-zinc-300', onClick: openClose }]
      : []
    ),
  ];

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {ACTIONS.map(({ Icon, label, iconBg, iconColor, onClick }) => (
          <button key={label} onClick={onClick}
            className="group flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-2.5 py-2 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-[0_12px_28px_-20px_rgb(124_58_237_/_0.6)] active:translate-y-0 active:scale-[0.98] dark:border-white/[0.07] dark:bg-white/[0.035] dark:hover:border-primary/30">
            <span className={`h-8 w-8 rounded-xl flex items-center justify-center transition-transform duration-200 group-hover:scale-105 shrink-0 ${iconBg} ${iconColor}`}>
              <Icon size={15} strokeWidth={2} />
            </span>
            <span className="text-xs font-bold text-slate-700 dark:text-zinc-200">{label}</span>
          </button>
        ))}
      </div>

      {/* ── Nova Receita ── */}
      <Modal open={modal === 'income'} onClose={() => setModal(null)} title="Nova Receita" size="sm">
        <div className="space-y-3">
          <FormGroup label="Descrição" required>
            <Input value={incForm.description} onChange={(e) => setIncForm({ ...incForm, description: e.target.value })} placeholder="Ex: Salário" autoFocus />
          </FormGroup>
          <div className="grid grid-cols-2 gap-3">
            <FormGroup label="Valor" required>
              <Input type="number" min="0" step="0.01" value={incForm.value} onChange={(e) => setIncForm({ ...incForm, value: e.target.value })} />
            </FormGroup>
            <FormGroup label="Data">
              <Input type="date" value={incForm.date} onChange={(e) => setIncForm({ ...incForm, date: e.target.value })} />
            </FormGroup>
          </div>
          <FormGroup label="Forma de recebimento">
            <Select value={incForm.paymentMethod} onChange={(e) => setIncForm({ ...incForm, paymentMethod: e.target.value })}>
              {Object.entries(PM_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </FormGroup>
          <p className="text-xs text-muted">
            Categoria padrão "Outros" aplicada.{' '}
            <button onClick={() => { setModal(null); navigate('/incomes'); }} className="underline text-primary">Ir para Receitas</button>{' '}
            para escolher a categoria.
          </p>
          <div className="flex gap-2 justify-end pt-1">
            <Button variant="outline" size="sm" onClick={() => setModal(null)}>Cancelar</Button>
            <Button size="sm" onClick={saveIncome} loading={saving}>Salvar</Button>
          </div>
        </div>
      </Modal>

      {/* ── Nova Despesa ── */}
      <Modal open={modal === 'expense'} onClose={() => setModal(null)} title="Nova Despesa Variável" size="sm">
        <div className="space-y-3">
          <FormGroup label="Descrição" required>
            <Input value={expForm.description} onChange={(e) => setExpForm({ ...expForm, description: e.target.value })} placeholder="Ex: Mercado" autoFocus />
          </FormGroup>
          <div className="grid grid-cols-2 gap-3">
            <FormGroup label="Valor" required>
              <Input type="number" min="0" step="0.01" value={expForm.value} onChange={(e) => setExpForm({ ...expForm, value: e.target.value })} />
            </FormGroup>
            <FormGroup label="Data">
              <Input type="date" value={expForm.date} onChange={(e) => setExpForm({ ...expForm, date: e.target.value })} />
            </FormGroup>
          </div>
          <FormGroup label="Categoria">
            <Select value={expForm.categoryId} onChange={(e) => setExpForm({ ...expForm, categoryId: e.target.value })}>
              <option value="">Outros (padrão)</option>
              {expCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </FormGroup>
          <FormGroup label="Forma de pagamento">
            <Select value={expForm.paymentMethod} onChange={(e) => setExpForm({ ...expForm, paymentMethod: e.target.value, cardId: e.target.value === 'credit' ? expForm.cardId : '' })}>
              {Object.entries(PM_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </FormGroup>
          {expForm.paymentMethod === 'credit' && (
            <FormGroup label="Cartão" required>
              <Select value={expForm.cardId} onChange={(e) => setExpForm({ ...expForm, cardId: e.target.value })}>
                <option value="">Selecione o cartão...</option>
                {cards.filter((card) => card.active !== false).map((card) => (
                  <option key={card.id} value={card.id}>
                    {card.name} — disponível {formatCurrency(card.availableLimit)}
                  </option>
                ))}
              </Select>
            </FormGroup>
          )}
          <div className="flex gap-2 justify-end pt-1">
            <Button variant="outline" size="sm" onClick={() => setModal(null)}>Cancelar</Button>
            <Button size="sm" onClick={saveExpense} loading={saving}>Salvar</Button>
          </div>
        </div>
      </Modal>

      {/* ── Pagar Conta ── */}
      <Modal open={modal === 'pay'} onClose={() => setModal(null)} title="Pagar Conta" size="sm">
        <div className="space-y-3">
          {pendingExpenses.length === 0
            ? <p className="text-sm text-muted text-center py-4">Nenhuma conta pendente neste mês.</p>
            : <>
                <FormGroup label="Conta a pagar">
                  <Select value={payTarget?.id ?? ''} onChange={(e) => {
                    const exp = pendingExpenses.find((x) => String(x.id) === e.target.value);
                    setPayTarget(exp ?? null);
                    setPayAmount(String(exp?.value ?? ''));
                  }}>
                    <option value="">Selecione...</option>
                    {pendingExpenses.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.description} — {formatCurrency(e.value)}
                      </option>
                    ))}
                  </Select>
                </FormGroup>
                <div className="grid grid-cols-2 gap-3">
                  <FormGroup label="Valor pago">
                    <Input type="number" min="0" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
                  </FormGroup>
                  <FormGroup label="Forma">
                    <Select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                      {Object.entries(PM_LABELS).filter(([v]) => v !== 'credit').map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </Select>
                  </FormGroup>
                </div>
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" size="sm" onClick={() => setModal(null)}>Cancelar</Button>
                  <Button size="sm" onClick={payExpense} loading={saving}>Confirmar</Button>
                </div>
              </>}
        </div>
      </Modal>

      {/* ── Pagar Fatura ── */}
      <Modal open={modal === 'fatura'} onClose={() => setModal(null)} title="Pagar Fatura do Cartão" size="sm">
        <div className="space-y-3">
          {invoices.length === 0
            ? <p className="text-sm text-muted text-center py-4">Nenhuma fatura em aberto.</p>
            : <>
                <FormGroup label="Fatura">
                  <Select value={invoiceTarget?.id ?? ''} onChange={(e) =>
                    setInvoiceTarget(invoices.find((i) => String(i.id) === e.target.value) ?? null)
                  }>
                    <option value="">Selecione...</option>
                    {invoices.map((inv) => (
                      <option key={inv.id} value={inv.id}>
                        {inv.cardName} — {String(inv.referenceMonth).padStart(2, '0')}/{inv.referenceYear} — {formatCurrency(inv.totalValue)}
                      </option>
                    ))}
                  </Select>
                </FormGroup>
                {invoiceTarget && (
                  <div className="bg-subtle dark:bg-white/[0.04] rounded-xl p-3 text-sm">
                    Total: <span className="font-mono font-semibold">{formatCurrency(invoiceTarget.totalValue)}</span>
                  </div>
                )}
                <FormGroup label="Forma de pagamento">
                  <Select value={invMethod} onChange={(e) => setInvMethod(e.target.value)}>
                    {[['pix','PIX'],['debit','Débito'],['transfer','Transferência'],['cash','Dinheiro']].map(([v,l]) =>
                      <option key={v} value={v}>{l}</option>
                    )}
                  </Select>
                </FormGroup>
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" size="sm" onClick={() => setModal(null)}>Cancelar</Button>
                  <Button size="sm" onClick={payInvoice} loading={saving}>Pagar Fatura</Button>
                </div>
              </>}
        </div>
      </Modal>

      {/* ── Aporte em Meta ── */}
      <Modal open={modal === 'goal'} onClose={() => setModal(null)} title="Aporte em Meta" size="sm">
        <div className="space-y-3">
          {goals.length === 0
            ? <p className="text-sm text-muted text-center py-4">Nenhuma meta ativa.</p>
            : <>
                <FormGroup label="Meta">
                  <Select value={goalTarget?.id ?? ''} onChange={(e) =>
                    setGoalTarget(goals.find((g) => String(g.id) === e.target.value) ?? null)
                  }>
                    <option value="">Selecione...</option>
                    {goals.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} — faltam {formatCurrency(g.remaining ?? 0)}
                      </option>
                    ))}
                  </Select>
                </FormGroup>
                <FormGroup label="Valor do aporte" required>
                  <Input type="number" min="0" step="0.01" value={contribValue}
                    onChange={(e) => setContribValue(e.target.value)} placeholder="R$ 0,00" />
                </FormGroup>
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" size="sm" onClick={() => setModal(null)}>Cancelar</Button>
                  <Button size="sm" onClick={saveContrib} loading={saving}>Aportar</Button>
                </div>
              </>}
        </div>
      </Modal>

      {/* ── Fechar Mês ── */}
      <Modal open={modal === 'close'} onClose={() => setModal(null)} title="Fechar Mês" size="sm">
        <div className="space-y-4">
          {!preview
            ? <p className="text-sm text-muted">Carregando resumo...</p>
            : (
              <div className="bg-subtle dark:bg-white/[0.04] rounded-xl p-3 text-xs space-y-1.5">
                {[
                  ['Contas pendentes',       preview.pendingExpensesCount],
                  ['Faturas em aberto',      preview.openInvoicesCount],
                  ['Receitas a gerar',       preview.willGenerateNextMonth?.recurringIncomes],
                  ['Despesas fixas a gerar', preview.willGenerateNextMonth?.fixedExpenses],
                  ['Parcelas de dívida',     preview.willGenerateNextMonth?.debtInstallments],
                ].map(([label, val]) => (
                  <div key={label} className="flex justify-between">
                    <span className="text-muted">{label}</span>
                    <span className="font-mono font-semibold text-slate-800 dark:text-zinc-200">{val ?? 0}</span>
                  </div>
                ))}
              </div>
            )}
          <p className="text-xs text-muted">
            Pendências não pagas permanecem no histórico — nada é perdido ou duplicado.
          </p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => setModal(null)}>Cancelar</Button>
            <Button variant="danger" size="sm" onClick={closeMonth} loading={closing} disabled={!preview}>
              Encerrar Mês
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}