import { useState, useEffect, useCallback } from 'react';
import { cardsApi, categoriesApi } from '../lib/services';
import { extractErrorMessage } from '../lib/api';
import { formatCurrency, formatShortDate } from '../lib/format';
import { localDateInputValue } from '../lib/date';
import { Card, CardHeader, Badge, Button, EmptyState, ProgressBar } from '../components/ui/index';
import { Modal, ConfirmDialog, FormGroup, Input, Select } from '../components/ui/Modal';
import { CategorySelect } from '../components/ui/CategorySelect';
import { useUIStore } from '../store/uiStore';
import { ChoiceCards, AnimatedNumber } from '../components/ui/Motion';

const COLORS = ['#7C3AED','#2563EB','#16A34A','#F59E0B','#DC2626','#A855F7','#06B6D4'];
const STATUS_V = { open:'info', closed:'warning', paid:'success' };
const STATUS_L = { open:'Aberta', closed:'Fechada', paid:'Paga' };
const PAYMENT_OPTIONS = [
  { value:'pix', label:'PIX', icon:'⚡', tone:'choice-card-icon-primary' },
  { value:'debit', label:'Débito', icon:'▣', tone:'choice-card-icon-info' },
  { value:'transfer', label:'Transferência', icon:'⇄', tone:'choice-card-icon-primary' },
  { value:'cash', label:'Dinheiro', icon:'●', tone:'choice-card-icon-success' },
];

export default function CardsPage() {
  const [cards, setCards]     = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [loadingInv, setLoadingInv] = useState(false);
  const [tab, setTab] = useState('invoices');

  const [cardModal, setCardModal]   = useState(false);
  const [editCardModal, setEditCardModal] = useState(null); // cartão sendo editado, ou null
  const [deactivateTarget, setDeactivateTarget] = useState(null);
  const [deactivating, setDeactivating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletingCard, setDeletingCard] = useState(false);
  const [purchaseModal, setPurchaseModal] = useState(false);
  const [payTarget, setPayTarget]   = useState(null);
  const [saving, setSaving]         = useState(false);
  const [paying, setPaying]         = useState(false);
  const [invMethod, setInvMethod]   = useState('pix');

  const [cardForm, setCardForm] = useState({ name:'', color: COLORS[0], limitValue:'', closingDay:'20', dueDay:'27' });
  const [editCardForm, setEditCardForm] = useState({ name:'', color: COLORS[0], limitValue:'', closingDay:'', dueDay:'' });
  const [purchaseForm, setPurchaseForm] = useState({ description:'', categoryId:'', totalValue:'', installmentsCount:'1', purchaseDate: localDateInputValue() });

  const toast = useUIStore((s) => s);

  const loadCards = useCallback(async () => {
    setLoading(true);
    try {
      const [c, cats] = await Promise.all([cardsApi.list(), categoriesApi.list('expense')]);
      const list = c.data.cards ?? [];
      setCards(list);
      setCategories(cats.data.categories ?? []);
      // Usa a forma funcional para sempre reavaliar contra o valor atual de
      // `selected` (evita depender dele no array de deps do useCallback) —
      // depois de editar/desativar o cartão selecionado, isto garante que o
      // painel de detalhe mostre os dados atualizados na hora, em vez de
      // continuar com o objeto antigo até uma seleção manual.
      setSelected((prev) => {
        if (!prev) return list[0] ?? null;
        return list.find((card) => String(card.id) === String(prev.id)) ?? list[0] ?? null;
      });
    } catch { toast.error('Erro ao carregar cartões.'); }
    finally { setLoading(false); }
  }, []);

  const loadInvoices = useCallback(async () => {
    if (!selected) return;
    setLoadingInv(true);
    try { const r = await cardsApi.listInvoices(selected.id); setInvoices(r.data.invoices ?? []); }
    catch { toast.error('Erro ao carregar faturas.'); }
    finally { setLoadingInv(false); }
  }, [selected]);

  useEffect(() => { loadCards(); }, [loadCards]);
  useEffect(() => { loadInvoices(); }, [loadInvoices]);

  async function saveCard() {
    if (!cardForm.name || !cardForm.limitValue) { toast.error('Preencha nome e limite.'); return; }
    setSaving(true);
    try {
      await cardsApi.create({ ...cardForm, limitValue: parseFloat(cardForm.limitValue), closingDay: parseInt(cardForm.closingDay), dueDay: parseInt(cardForm.dueDay) });
      toast.success('Cartão criado!'); setCardModal(false); loadCards();
    } catch (e) { toast.error(extractErrorMessage(e, 'Erro.')); }
    finally { setSaving(false); }
  }

  function openEditCard(card) {
    setEditCardForm({
      name: card.name,
      color: card.color ?? COLORS[0],
      limitValue: String(card.limitValue),
      closingDay: String(card.closingDay),
      dueDay: String(card.dueDay),
    });
    setEditCardModal(card);
  }

  async function saveEditCard() {
    if (!editCardForm.name || !editCardForm.limitValue) { toast.error('Preencha nome e limite.'); return; }
    setSaving(true);
    try {
      await cardsApi.update(editCardModal.id, {
        ...editCardForm,
        limitValue: parseFloat(editCardForm.limitValue),
        closingDay: parseInt(editCardForm.closingDay),
        dueDay: parseInt(editCardForm.dueDay),
      });
      toast.success('Cartão atualizado!'); setEditCardModal(null); loadCards();
    } catch (e) { toast.error(extractErrorMessage(e, 'Erro ao atualizar cartão.')); }
    finally { setSaving(false); }
  }

  async function handleDeactivate() {
    setDeactivating(true);
    try {
      await cardsApi.deactivate(deactivateTarget.id);
      toast.success('Cartão desativado. O histórico de faturas e compras foi mantido.');
      setDeactivateTarget(null); loadCards();
    } catch (e) { toast.error(extractErrorMessage(e, 'Erro ao desativar cartão.')); }
    finally { setDeactivating(false); }
  }

  async function handleDeleteCard() {
    setDeletingCard(true);
    try {
      const res = await cardsApi.delete(deleteTarget.id);
      const counts = res.data?.deletedCounts;
      toast.success(
        counts && (counts.purchases > 0 || counts.invoices > 0)
          ? `Cartão excluído junto com ${counts.purchases} compra(s) e ${counts.expenses} despesa(s) associadas.`
          : 'Cartão excluído.'
      );
      setDeleteTarget(null); loadCards();
    } catch (e) {
      // Mensagem do backend já é acionável (ex: sugere desativar quando há
      // histórico em mês encerrado) — não precisa de tratamento especial.
      toast.error(extractErrorMessage(e, 'Erro ao excluir cartão.'));
    }
    finally { setDeletingCard(false); }
  }

  async function savePurchase() {
    if (!selected || !purchaseForm.description || !purchaseForm.totalValue) { toast.error('Preencha os campos obrigatórios.'); return; }
    setSaving(true);
    try {
      const cat = purchaseForm.categoryId || (categories[0]?.id ?? '');
      await cardsApi.createPurchase(selected.id, { ...purchaseForm, totalValue: parseFloat(purchaseForm.totalValue), installmentsCount: parseInt(purchaseForm.installmentsCount), startingInstallment: parseInt(purchaseForm.startingInstallment) || 1, categoryId: String(cat) });
      toast.success('Compra registrada!'); setPurchaseModal(false); loadCards(); loadInvoices();
    } catch (e) { toast.error(extractErrorMessage(e, 'Erro.')); }
    finally { setSaving(false); }
  }

  async function payInvoice() {
    setPaying(true);
    try {
      await cardsApi.payInvoice(payTarget.id, { paymentMethod: invMethod });
      toast.success('Fatura paga com sucesso!'); setPayTarget(null); loadInvoices(); loadCards();
    } catch (e) { toast.error(extractErrorMessage(e, 'Erro.')); }
    finally { setPaying(false); }
  }

  if (loading) return (
    <div className="space-y-4 animate-pulse">
      <div className="auto-grid-comfortable">{Array.from({length:3}).map((_,i)=><div key={i} className="h-44 shimmer-bg rounded-3xl" />)}</div>
    </div>
  );

  return (
    <div data-tutorial-page-ready="cards" className="space-y-6 animate-page-enter">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-[-0.025em] text-slate-950 dark:text-white">Cartões de Crédito</h2>
          <p className="text-sm text-muted mt-0.5">{cards.length} cartão(ões) cadastrado(s)</p>
        </div>
        <Button onClick={() => setCardModal(true)}>+ Novo Cartão</Button>
      </div>

      <div data-tutorial="cards-area">
      {cards.length === 0 ? (
        <Card data-tutorial="cards-empty"><EmptyState icon="💳" title="Nenhum cartão cadastrado" description="Adicione um cartão para controlar gastos e faturas."
          action={<Button onClick={() => setCardModal(true)}>Adicionar cartão</Button>} /></Card>
      ) : (
        <>
          {/* Cards visuais */}
          <div data-tutorial="cards-list" className="auto-grid-wide">
            {cards.map((card) => {
              const pct = Math.min(Math.round((card.usedLimit / Number(card.limitValue)) * 100), 100);
              const isSelected = String(selected?.id) === String(card.id);
              const isInactive = card.active === false;
              return (
                <button key={card.id} onClick={() => setSelected(card)} className={`credit-card-visual group relative overflow-hidden text-left rounded-[24px] border border-white/20 p-5 text-white transition-all duration-300 active:translate-y-0 active:scale-[0.985] ${isSelected ? 'ring-2 ring-primary-light/70 ring-offset-2 ring-offset-bg shadow-floating dark:ring-offset-canvas-dark' : 'shadow-[0_22px_46px_-26px_rgb(15_23_42_/_0.55)]'} ${isInactive ? 'grayscale opacity-60' : ''}`}
                  style={{ background: `linear-gradient(135deg, ${card.color ?? '#7C3AED'}, ${card.color ?? '#7C3AED'}99)` }}>
                  {isInactive && (
                    <span className="absolute top-3 right-3 text-[10px] font-semibold uppercase tracking-wider bg-black/30 px-2 py-1 rounded-lg">
                      Desativado
                    </span>
                  )}
                  <span className="pointer-events-none absolute -right-10 -top-16 h-36 w-36 rounded-full bg-white/15 blur-2xl transition-transform duration-500 group-hover:scale-125" /><span className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-black/10" /><div className="relative mb-4 flex items-center justify-between"><span className="credit-card-chip" aria-hidden="true" /><span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/55">FinanceHub</span></div><div className="relative flex justify-between items-start mb-4">
                    <p className="font-bold text-lg">{card.name}</p>
                    {!isInactive && (
                      <span className="text-white/60 text-xs bg-white/10 px-2 py-1 rounded-lg">
                        Fecha d{card.closingDay}
                      </span>
                    )}
                  </div>
                  <p className="relative font-mono text-2xl font-bold mb-1 tracking-tight"><AnimatedNumber value={card.availableLimit} formatter={formatCurrency} /></p>
                  <p className="relative text-white/65 text-xs mb-3">disponível de {formatCurrency(card.limitValue)}</p>
                  <div className="relative h-1.5 bg-white/20 rounded-full overflow-hidden">
                    <div className="h-full bg-white rounded-full transition-all duration-700" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="relative text-white/65 text-xs mt-1.5 text-right">{pct}% utilizado</p>
                </button>
              );
            })}
          </div>

          {/* Detalhe do cartão selecionado */}
          {selected && (
            <Card padding={false}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-border dark:border-white/[0.06] flex-wrap gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-slate-900 dark:text-zinc-50">{selected.name}</h3>
                    {selected.active === false && <Badge variant="default">Desativado</Badge>}
                  </div>
                  <p className="text-xs text-muted mt-0.5">
                    Fecha dia {selected.closingDay} · Vence dia {selected.dueDay} · Limite {formatCurrency(selected.limitValue)}
                  </p>
                </div>
                <div className="flex gap-2 items-center flex-wrap">
                  <div className="flex gap-1 bg-subtle dark:bg-white/5 p-1 rounded-xl">
                    {['invoices'].map((t) => (
                      <button key={t} onClick={() => setTab(t)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${tab===t?'bg-white dark:bg-panel-dark shadow text-slate-900 dark:text-zinc-50':'text-muted'}`}>
                        Faturas
                      </button>
                    ))}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => openEditCard(selected)}>Editar</Button>
                  {selected.active !== false && (
                    <Button variant="ghost" size="sm" onClick={() => setDeactivateTarget(selected)}>Desativar</Button>
                  )}
                  <Button variant="ghost" size="sm" className="text-danger" onClick={() => setDeleteTarget(selected)}>
                    {selected.hasHistory ? 'Excluir permanentemente' : 'Excluir'}
                  </Button>
                  {selected.active === false ? (
                    <span className="text-xs text-muted italic">Não aceita novas compras</span>
                  ) : (
                    <Button size="sm" onClick={() => { setPurchaseForm({ description:'', categoryId:'', totalValue:'', installmentsCount:'1', startingInstallment:'1', purchaseDate: localDateInputValue() }); setPurchaseModal(true); }}>
                      + Compra
                    </Button>
                  )}
                </div>
              </div>

              {loadingInv ? (
                <div className="p-5 space-y-3">{Array.from({length:3}).map((_,i)=><div key={i} className="h-10 shimmer-bg rounded-xl" />)}</div>
              ) : invoices.length === 0 ? (
                <EmptyState icon="🧾" title="Sem faturas" description="As faturas serão geradas automaticamente conforme você registrar compras." />
              ) : (
                <div className="data-table-scroll">
                  <table className="w-full text-sm">
                    <thead className="bg-subtle/60 dark:bg-white/[0.03]"><tr>
                      {['Referência','Fechamento','Vencimento','Total','Status',''].map(h=><th key={h} className="table-header">{h}</th>)}
                    </tr></thead>
                    <tbody className="divide-y divide-border/60 dark:divide-white/[0.06]">
                      {invoices.map((inv) => (
                        <tr key={inv.id} className="hover:bg-subtle/40 dark:hover:bg-white/[0.03] transition-colors">
                          <td className="table-cell font-semibold text-slate-800 dark:text-zinc-200">{String(inv.referenceMonth).padStart(2,'0')}/{inv.referenceYear}</td>
                          <td className="table-cell text-muted">{formatShortDate(inv.closingDate)}</td>
                          <td className="table-cell text-muted">{formatShortDate(inv.dueDate)}</td>
                          <td className="table-cell font-mono tabular-nums font-bold text-slate-800 dark:text-zinc-200">{formatCurrency(inv.totalValue)}</td>
                          <td className="table-cell"><Badge variant={STATUS_V[inv.status]}>{STATUS_L[inv.status]}</Badge></td>
                          <td className="table-cell">
                            {inv.status !== 'paid' && (
                              <Button size="sm" onClick={() => { setPayTarget(inv); setInvMethod('pix'); }}>Pagar</Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
        </>
      )}
      </div>

      {/* Modal Novo Cartão */}
      <Modal open={cardModal} onClose={() => setCardModal(false)} title="Novo Cartão" size="sm">
        <div className="space-y-4">
          <FormGroup label="Nome do cartão" required><Input value={cardForm.name} onChange={(e) => setCardForm({...cardForm,name:e.target.value})} placeholder="Ex: Nubank, Inter..." /></FormGroup>
          <FormGroup label="Limite de crédito" required><Input type="number" min="0" step="0.01" value={cardForm.limitValue} onChange={(e) => setCardForm({...cardForm,limitValue:e.target.value})} /></FormGroup>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormGroup label="Dia de fechamento"><Input type="number" min="1" max="31" value={cardForm.closingDay} onChange={(e) => setCardForm({...cardForm,closingDay:e.target.value})} /></FormGroup>
            <FormGroup label="Dia de vencimento"><Input type="number" min="1" max="31" value={cardForm.dueDay} onChange={(e) => setCardForm({...cardForm,dueDay:e.target.value})} /></FormGroup>
          </div>
          <FormGroup label="Cor do cartão">
            <div className="flex gap-2 flex-wrap mt-1">
              {COLORS.map((c) => (
                <button key={c} onClick={() => setCardForm({...cardForm,color:c})}
                  className={`h-9 w-9 rounded-xl transition-all hover:scale-110 ${cardForm.color===c?'ring-2 ring-offset-2 ring-slate-400 scale-110':''}`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
          </FormGroup>
          <div className="modal-actions">
            <Button variant="outline" onClick={() => setCardModal(false)}>Cancelar</Button>
            <Button onClick={saveCard} loading={saving}>Criar Cartão</Button>
          </div>
        </div>
      </Modal>

      {/* Modal Editar Cartão */}
      <Modal open={!!editCardModal} onClose={() => setEditCardModal(null)} title={`Editar Cartão — ${editCardModal?.name ?? ''}`} size="sm">
        <div className="space-y-4">
          <FormGroup label="Nome do cartão" required><Input value={editCardForm.name} onChange={(e) => setEditCardForm({...editCardForm,name:e.target.value})} /></FormGroup>
          <FormGroup label="Limite de crédito" required hint="pode ser alterado a qualquer momento">
            <Input type="number" min="0" step="0.01" value={editCardForm.limitValue} onChange={(e) => setEditCardForm({...editCardForm,limitValue:e.target.value})} />
          </FormGroup>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormGroup label="Dia de fechamento"><Input type="number" min="1" max="31" value={editCardForm.closingDay} onChange={(e) => setEditCardForm({...editCardForm,closingDay:e.target.value})} /></FormGroup>
            <FormGroup label="Dia de vencimento"><Input type="number" min="1" max="31" value={editCardForm.dueDay} onChange={(e) => setEditCardForm({...editCardForm,dueDay:e.target.value})} /></FormGroup>
          </div>
          <FormGroup label="Cor do cartão">
            <div className="flex gap-2 flex-wrap mt-1">
              {COLORS.map((c) => (
                <button key={c} onClick={() => setEditCardForm({...editCardForm,color:c})}
                  className={`h-9 w-9 rounded-xl transition-all hover:scale-110 ${editCardForm.color===c?'ring-2 ring-offset-2 ring-slate-400 scale-110':''}`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
          </FormGroup>
          <div className="modal-actions">
            <Button variant="outline" onClick={() => setEditCardModal(null)}>Cancelar</Button>
            <Button onClick={saveEditCard} loading={saving}>Salvar Alterações</Button>
          </div>
        </div>
      </Modal>

      {/* Confirmação de desativação */}
      <ConfirmDialog
        open={!!deactivateTarget}
        onClose={() => setDeactivateTarget(null)}
        onConfirm={handleDeactivate}
        loading={deactivating}
        title="Desativar cartão"
        confirmLabel="Desativar"
        description={`"${deactivateTarget?.name}" deixará de aceitar novas compras (continua aparecendo na lista, marcado como desativado). Faturas e compras já registradas continuam salvas no histórico.`}
      />

      {/* Confirmação de exclusão real */}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteCard}
        loading={deletingCard}
        title={deleteTarget?.hasHistory ? 'Excluir cartão permanentemente' : 'Excluir cartão'}
        confirmLabel="Excluir"
        description={
          deleteTarget?.hasHistory
            ? `"${deleteTarget?.name}" tem compras e faturas registradas. Excluir vai apagar o cartão E todo esse histórico (incluindo despesas já lançadas) para sempre — isso pode mudar totais de meses passados. Se algum lançamento estiver em um mês já encerrado, a exclusão será bloqueada e você pode usar "Desativar" em vez disso.`
            : `"${deleteTarget?.name}" será excluído permanentemente. Este cartão ainda não tem nenhuma compra ou fatura registrada, então nada além dele será apagado.`
        }
      />


      {/* Modal Nova Compra */}
      <Modal open={purchaseModal} onClose={() => setPurchaseModal(false)} title={`Nova Compra — ${selected?.name}`} size="lg">
        <div className="space-y-4">
          <FormGroup label="Descrição" required><Input value={purchaseForm.description} onChange={(e) => setPurchaseForm({...purchaseForm,description:e.target.value})} placeholder="Ex: Tênis, Notebook..." /></FormGroup>
          <FormGroup label="Categoria">
            <CategorySelect
              value={purchaseForm.categoryId}
              onChange={(e) => setPurchaseForm({...purchaseForm,categoryId:e.target.value})}
              categories={categories}
              type="expense"
              onCategoryCreated={(cat) => setCategories((prev) => [...prev, cat])}
            />
          </FormGroup>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <FormGroup label="Valor total" required><Input type="number" min="0" step="0.01" value={purchaseForm.totalValue} onChange={(e) => setPurchaseForm({...purchaseForm,totalValue:e.target.value})} /></FormGroup>
            <FormGroup label="Parcelas"><Input type="number" min="1" max="48" value={purchaseForm.installmentsCount} onChange={(e) => setPurchaseForm({...purchaseForm,installmentsCount:e.target.value})} /></FormGroup>
            <FormGroup label="Data"><Input type="date" value={purchaseForm.purchaseDate} onChange={(e) => setPurchaseForm({...purchaseForm,purchaseDate:e.target.value})} /></FormGroup>
          </div>
          {purchaseForm.totalValue && parseInt(purchaseForm.installmentsCount) > 0 && (
            <div className="bg-primary-subtle border border-primary/20 rounded-xl p-3 text-sm">
              <span className="text-primary-dark font-medium">{purchaseForm.installmentsCount}x de </span>
              <span className="font-mono font-bold text-primary-dark">{formatCurrency(parseFloat(purchaseForm.totalValue||0)/parseInt(purchaseForm.installmentsCount||1))}</span>
            </div>
          )}
          {parseInt(purchaseForm.installmentsCount) > 1 && (
            <FormGroup label="Essa compra já está em andamento? (ex.: já estou na parcela 4)">
              <Input type="number" min="1" max={purchaseForm.installmentsCount} value={purchaseForm.startingInstallment ?? '1'}
                onChange={(e) => setPurchaseForm({...purchaseForm,startingInstallment:e.target.value})} />
              <p className="text-xs text-muted mt-1.5">Deixe em 1 se a compra é nova. Lança fatura só a partir da parcela informada.</p>
            </FormGroup>
          )}
          <div className="modal-actions">
            <Button variant="outline" onClick={() => setPurchaseModal(false)}>Cancelar</Button>
            <Button onClick={savePurchase} loading={saving}>Registrar Compra</Button>
          </div>
        </div>
      </Modal>

      {/* Modal Pagar Fatura */}
      <Modal open={!!payTarget} onClose={() => setPayTarget(null)} title="Pagar Fatura" size="sm">
        {payTarget && (
          <div className="space-y-4">
            <div className="bg-subtle dark:bg-white/[0.04] rounded-2xl p-4">
              <p className="text-xs text-muted mb-1">Valor total da fatura</p>
              <p className="text-3xl font-bold font-mono text-slate-900 dark:text-zinc-50">{formatCurrency(payTarget.totalValue)}</p>
              <p className="text-xs text-muted mt-1">{String(payTarget.referenceMonth).padStart(2,'0')}/{payTarget.referenceYear}</p>
            </div>
            <FormGroup label="Forma de pagamento">
              <ChoiceCards compact columns={2} value={invMethod} onChange={setInvMethod} options={PAYMENT_OPTIONS} />
            </FormGroup>
            <div className="modal-actions">
              <Button variant="outline" onClick={() => setPayTarget(null)}>Cancelar</Button>
              <Button onClick={payInvoice} loading={paying}>Confirmar Pagamento</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}