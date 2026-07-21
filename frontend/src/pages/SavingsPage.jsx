import { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { savingsApi } from '../lib/services';
import { extractErrorMessage } from '../lib/api';
import { formatCurrency, formatShortDate } from '../lib/format';
import { localDateInputValue, apiDateToInput } from '../lib/date';
import { Card, CardHeader, Badge, Button, EmptyState } from '../components/ui/index';
import { Modal, ConfirmDialog, FormGroup, Input } from '../components/ui/Modal';
import { useUIStore } from '../store/uiStore';
import { useThemeStore } from '../store/themeStore';
import { ChoiceCards, AnimatedNumber } from '../components/ui/Motion';

// No nível do módulo (não dentro de SavingsPage) — mesmo motivo do ajuste
// em WhatIfSimulatorPage.jsx/GoalsPage.jsx: uma função-componente definida
// dentro de outro componente perde a identidade estável entre renders.
// Aqui não há campo de texto (não causava perda de foco), mas o tooltip
// do gráfico remontava a cada render de SavingsPage sem necessidade.
function CustomTooltip({ active, payload, label }) {
  const theme = useThemeStore((s) => s.theme);
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <p className="text-muted mb-1">{label}</p>
      <p className="font-bold text-success-dark dark:text-success-light">{formatCurrency(payload[0]?.value)}</p>
    </div>
  );
}

export default function SavingsPage() {
  const [data, setData]       = useState({ balance: 0, transactions: [], breakdown: null });
  const [loading, setLoading] = useState(true);
  const [modal, setModal]     = useState(null);
  const [form, setForm]       = useState({ value:'', date: localDateInputValue(), observation:'', origin:'balance' });
  const [saving, setSaving]   = useState(false);
  const [editTxModal, setEditTxModal] = useState(null);
  const [editTxForm, setEditTxForm]   = useState({ value:'', date:'', observation:'' });
  const [deleteTxTarget, setDeleteTxTarget] = useState(null);
  const [deletingTx, setDeletingTx]   = useState(false);
  const toast = useUIStore((s) => s);
  const theme = useThemeStore((s) => s.theme);
  const gridStroke = theme === 'dark' ? 'rgba(255,255,255,0.06)' : '#F1F5F9';
  const axisColor  = theme === 'dark' ? '#71717A' : '#94A3B8';

  const load = async () => {
    setLoading(true);
    try { const r = await savingsApi.get(); setData(r.data); }
    catch { toast.error('Erro ao carregar reserva.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  function openModal(type) {
    setModal(type);
    setForm({ value:'', date: localDateInputValue(), observation:'', origin:'balance' });
  }

  async function handle() {
    if (!form.value || parseFloat(form.value) <= 0) { toast.error('Informe um valor válido.'); return; }
    setSaving(true);
    try {
      const fn = modal === 'deposit' ? savingsApi.deposit : savingsApi.withdraw;
      await fn({
        value: parseFloat(form.value), date: form.date, observation: form.observation,
        ...(modal === 'deposit' ? { origin: form.origin } : {}),
      });
      toast.success(modal === 'deposit' ? 'Depósito realizado!' : 'Retirada realizada!');
      setModal(null); load();
    } catch (e) { toast.error(extractErrorMessage(e, 'Erro.')); }
    finally { setSaving(false); }
  }

  function openEditTx(t) {
    setEditTxForm({
      value: String(t.value),
      date: apiDateToInput(t.transactionDate),
      observation: t.observation ?? '',
    });
    setEditTxModal(t);
  }

  async function saveEditTx() {
    if (!editTxForm.value || parseFloat(editTxForm.value) <= 0) { toast.error('Informe um valor válido.'); return; }
    setSaving(true);
    try {
      await savingsApi.update(editTxModal.id, {
        value: parseFloat(editTxForm.value),
        date: editTxForm.date,
        observation: editTxForm.observation || undefined,
      });
      toast.success('Lançamento atualizado!'); setEditTxModal(null); load();
    } catch (e) { toast.error(extractErrorMessage(e, 'Erro ao atualizar.')); }
    finally { setSaving(false); }
  }

  async function handleDeleteTx() {
    setDeletingTx(true);
    try {
      await savingsApi.delete(deleteTxTarget.id);
      toast.success('Lançamento excluído.'); setDeleteTxTarget(null); load();
    } catch (e) { toast.error(extractErrorMessage(e, 'Erro ao excluir.')); }
    finally { setDeletingTx(false); }
  }

  const chartData = [...(data.transactions ?? [])].reverse().map((t) => ({
    label: formatShortDate(t.transactionDate),
    saldo: Number(t.balanceAfter),
  }));

  return (
    <div data-tutorial-page-ready={!loading ? 'savings' : undefined} className="space-y-6 animate-page-enter">
      {/* Hero card */}
      <div className="bg-gradient-to-br from-success to-success-dark rounded-3xl p-6 text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-0 right-0 w-64 h-64 bg-white rounded-full -translate-y-1/2 translate-x-1/2" />
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-white rounded-full translate-y-1/2 -translate-x-1/2" />
        </div>
        <div className="relative">
          <p className="text-white/70 text-sm font-medium mb-1">Saldo Guardado</p>
          <p className="responsive-money font-bold font-mono mb-4"><AnimatedNumber value={data.balance} formatter={formatCurrency} /></p>
          <p className="text-white/60 text-xs mb-6">Reserva financeira separada do fluxo mensal</p>
          <div data-tutorial="savings-actions" className="flex gap-3">
            <Button variant="outline" onClick={() => openModal('withdraw')}
              className="bg-white/10 border-white/30 text-white hover:bg-white/20 flex-1 justify-center">
              − Retirar
            </Button>
            <Button onClick={() => openModal('deposit')}
              className="bg-white text-success-dark hover:bg-white/90 flex-1 justify-center font-bold">
              + Depositar
            </Button>
          </div>
        </div>
      </div>

      {/* Resumo por origem — pedido explícito da reforma: sempre mostrar
          quanto do total realmente saiu do saldo vs. só foi informado */}
      {data.breakdown && (data.breakdown.movedFromBalance > 0 || data.breakdown.externalReported > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Card className="!p-4">
            <p className="text-xs text-muted mb-1">Saiu do saldo disponível</p>
            <p className="text-lg font-bold font-mono text-slate-900 dark:text-zinc-50">{formatCurrency(data.breakdown.movedFromBalance)}</p>
          </Card>
          <Card className="!p-4">
            <p className="text-xs text-muted mb-1">Informado como já guardado</p>
            <p className="text-lg font-bold font-mono text-slate-900 dark:text-zinc-50">{formatCurrency(data.breakdown.externalReported)}</p>
          </Card>
        </div>
      )}

      {/* Gráfico */}
      {chartData.length > 1 && (
        <Card>
          <CardHeader title="Evolução da Reserva" />
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ left: -20 }}>
                <defs>
                  <linearGradient id="saldoGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#16A34A" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#16A34A" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: axisColor }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: axisColor }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="saldo" stroke="#16A34A" strokeWidth={2.5} fill="url(#saldoGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Histórico */}
      <Card padding={false}>
        <div className="px-5 py-4 border-b border-border dark:border-white/[0.06]">
          <h3 className="font-semibold text-slate-900 dark:text-zinc-50">Histórico de Movimentações</h3>
          <p className="text-xs text-muted mt-0.5">Só o lançamento mais recente pode ser editado ou excluído — isso preserva o saldo acumulado dos anteriores.</p>
        </div>
        {loading ? <div className="p-5 space-y-3">{Array.from({length:4}).map((_,i)=><div key={i} className="h-10 shimmer-bg rounded-xl" />)}</div>
          : data.transactions.length === 0
            ? <EmptyState icon="🏦" title="Sem movimentações" description="Faça o primeiro depósito para começar sua reserva de emergência." />
            : (
              <div className="data-table-scroll">
                <table className="w-full text-sm">
                  <thead className="bg-subtle/60 dark:bg-white/[0.03]"><tr>
                    {['Tipo','Valor','Saldo após','Data','Observação',''].map(h=>(
                      <th key={h} className="table-header">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody className="divide-y divide-border/60 dark:divide-white/[0.06]">
                    {data.transactions.map((t, idx) => (
                      <tr key={t.id} className="hover:bg-subtle/40 dark:hover:bg-white/[0.03] transition-colors">
                        <td className="table-cell">
                          <Badge variant={t.type==='deposit'?'success':'danger'}>{t.type==='deposit'?'Depósito':'Retirada'}</Badge>
                        </td>
                        <td className={`table-cell font-mono tabular-nums font-bold ${t.type==='deposit'?'text-success-dark dark:text-success-light':'text-danger-dark dark:text-danger-light'}`}>
                          {t.type==='deposit'?'+':'-'}{formatCurrency(t.value)}
                        </td>
                        <td className="table-cell font-mono tabular-nums text-slate-600 dark:text-zinc-400">{formatCurrency(t.balanceAfter)}</td>
                        <td className="table-cell text-muted">{formatShortDate(t.transactionDate)}</td>
                        <td className="table-cell text-muted">{t.observation ?? '—'}</td>
                        <td className="table-cell">
                          {idx === 0 && (
                            <div className="flex items-center gap-2 justify-end">
                              <Button size="sm" variant="ghost" onClick={() => openEditTx(t)}>Editar</Button>
                              <Button size="sm" variant="ghost" className="text-danger" onClick={() => setDeleteTxTarget(t)}>Excluir</Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
      </Card>

      {/* Modal */}
      <Modal open={!!modal} onClose={() => setModal(null)} title={modal==='deposit'?'Depositar na Reserva':'Retirar da Reserva'} size="sm">
        <div className="space-y-4">
          {modal === 'deposit' && (
            <>
              <FormGroup label="De onde vem esse valor?" required>
                <ChoiceCards columns={2} value={form.origin} onChange={(origin) => setForm({ ...form, origin })} options={[
                  { value:'balance', label:'Saldo disponível', description:'Desconta do seu caixa agora.', icon:'↘', tone:'choice-card-icon-primary' },
                  { value:'external', label:'Valor externo', description:'Apenas registra o que já estava guardado.', icon:'＋', tone:'choice-card-icon-success' },
                ]} />
              </FormGroup>
              <div className="bg-success-subtle border border-success/20 rounded-xl p-3 text-xs text-success-dark dark:bg-success/10 dark:text-success-light">
                {form.origin === 'balance'
                  ? '💡 O valor será descontado do seu saldo disponível agora.'
                  : 'ℹ️ Só entra na reserva — seu saldo disponível não muda.'}
              </div>
            </>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormGroup label="Valor" required><Input type="number" min="0" step="0.01" value={form.value} onChange={(e) => setForm({...form,value:e.target.value})} /></FormGroup>
            <FormGroup label="Data"><Input type="date" value={form.date} onChange={(e) => setForm({...form,date:e.target.value})} /></FormGroup>
          </div>
          <FormGroup label="Observação"><Input value={form.observation} onChange={(e) => setForm({...form,observation:e.target.value})} placeholder="Opcional" /></FormGroup>
          <div className="modal-actions">
            <Button variant="outline" onClick={() => setModal(null)}>Cancelar</Button>
            <Button variant={modal==='deposit'?'primary':'danger'} onClick={handle} loading={saving}>
              {modal==='deposit'?'Depositar':'Retirar'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Editar último lançamento */}
      <Modal open={!!editTxModal} onClose={() => setEditTxModal(null)} title={`Editar ${editTxModal?.type==='deposit'?'Depósito':'Retirada'}`} size="sm">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormGroup label="Valor" required><Input type="number" min="0" step="0.01" value={editTxForm.value} onChange={(e) => setEditTxForm({...editTxForm,value:e.target.value})} /></FormGroup>
            <FormGroup label="Data"><Input type="date" value={editTxForm.date} onChange={(e) => setEditTxForm({...editTxForm,date:e.target.value})} /></FormGroup>
          </div>
          <FormGroup label="Observação"><Input value={editTxForm.observation} onChange={(e) => setEditTxForm({...editTxForm,observation:e.target.value})} placeholder="Opcional" /></FormGroup>
          <div className="modal-actions">
            <Button variant="outline" onClick={() => setEditTxModal(null)}>Cancelar</Button>
            <Button onClick={saveEditTx} loading={saving}>Salvar Alteração</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTxTarget}
        onClose={() => setDeleteTxTarget(null)}
        onConfirm={handleDeleteTx}
        loading={deletingTx}
        title="Excluir lançamento"
        confirmLabel="Excluir"
        description={`Excluir este ${deleteTxTarget?.type==='deposit'?'depósito':'saque'} de ${formatCurrency(deleteTxTarget?.value ?? 0)}? O saldo guardado volta a ser o que era antes dele.`}
      />
    </div>
  );
}