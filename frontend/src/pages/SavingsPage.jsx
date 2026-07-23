import { useEffect, useMemo, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { savingsApi } from '../lib/services';
import { extractErrorMessage } from '../lib/api';
import { formatCurrency, formatShortDate } from '../lib/format';
import { apiDateToInput, ledgerMonthDateInputValue, ledgerMonthDateRange } from '../lib/date';
import { Card, CardHeader, Badge, Button, EmptyState } from '../components/ui/index';
import { Modal, ConfirmDialog, FormGroup, Input, Select } from '../components/ui/Modal';
import { useUIStore } from '../store/uiStore';
import { useThemeStore } from '../store/themeStore';
import { useMonthStore } from '../store/monthStore';
import { ChoiceCards, AnimatedNumber } from '../components/ui/Motion';

const GENERAL_BUCKET_KIND = { value: 'general', label: 'Reserva geral', icon: '🏦', description: 'Para valores sem uma finalidade específica.' };

const BUCKET_KINDS = [
  { value: 'emergency', label: 'Reserva de emergência', icon: '🛟', description: 'Proteção para imprevistos.' },
  { value: 'travel', label: 'Viagem', icon: '✈️', description: 'Passagens, hospedagem e passeios.' },
  { value: 'home', label: 'Casa', icon: '🏠', description: 'Mudança, reforma ou entrada.' },
  { value: 'education', label: 'Educação', icon: '🎓', description: 'Cursos, faculdade e estudos.' },
  { value: 'vehicle', label: 'Veículo', icon: '🚗', description: 'Compra, manutenção ou documentação.' },
  { value: 'custom', label: 'Outra finalidade', icon: '📦', description: 'Crie uma caixinha personalizada.' },
];

const KIND_META = {
  general: { label: 'Reserva geral', icon: '🏦' },
  emergency: { label: 'Reserva de emergência', icon: '🛟' },
  travel: { label: 'Viagem', icon: '✈️' },
  home: { label: 'Casa', icon: '🏠' },
  education: { label: 'Educação', icon: '🎓' },
  vehicle: { label: 'Veículo', icon: '🚗' },
  custom: { label: 'Caixinha', icon: '📦' },
};

function bucketName(bucket) {
  return bucket?.name?.trim() || KIND_META[bucket?.kind]?.label || 'Caixinha';
}

function bucketIcon(bucket) {
  return KIND_META[bucket?.kind]?.icon || '📦';
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <p className="text-muted mb-1">{label}</p>
      <p className="font-bold text-success-dark dark:text-success-light">{formatCurrency(payload[0]?.value)}</p>
    </div>
  );
}

export default function SavingsPage() {
  const selectedMonth = useMonthStore((state) => state.months.find(
    (month) => String(month.id) === String(state.selectedMonthId)
  ) ?? null);
  const selectedMonthDateRange = ledgerMonthDateRange(selectedMonth);
  const defaultDate = ledgerMonthDateInputValue(selectedMonth);
  const [data, setData] = useState({ balance: 0, buckets: [], archivedBuckets: [], transactions: [], breakdown: null });
  const [loading, setLoading] = useState(true);
  const [movement, setMovement] = useState(null);
  const [movementForm, setMovementForm] = useState({ value: '', date: defaultDate, observation: '', origin: 'balance' });
  const [bucketModal, setBucketModal] = useState(null);
  const [bucketForm, setBucketForm] = useState({ kind: 'emergency', name: '', targetValue: '' });
  const [transferModal, setTransferModal] = useState(false);
  const [transferForm, setTransferForm] = useState({ fromBucketId: '', toBucketId: '', value: '', date: defaultDate, observation: '' });
  const [saving, setSaving] = useState(false);
  const [editTxModal, setEditTxModal] = useState(null);
  const [editTxForm, setEditTxForm] = useState({ value: '', date: '', observation: '', origin: 'balance' });
  const [deleteTxTarget, setDeleteTxTarget] = useState(null);
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const toast = useUIStore((state) => state);
  const theme = useThemeStore((state) => state.theme);
  const gridStroke = theme === 'dark' ? 'rgba(255,255,255,0.06)' : '#F1F5F9';
  const axisColor = theme === 'dark' ? '#71717A' : '#94A3B8';

  const load = async () => {
    setLoading(true);
    try {
      const response = await savingsApi.get();
      setData({
        balance: response.data.balance ?? 0,
        buckets: response.data.buckets ?? [],
        archivedBuckets: response.data.archivedBuckets ?? [],
        transactions: response.data.transactions ?? [],
        breakdown: response.data.breakdown ?? null,
      });
    } catch (error) {
      toast.error(extractErrorMessage(error, 'Erro ao carregar reservas.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    setMovementForm((current) => ({ ...current, date: defaultDate }));
    setTransferForm((current) => ({ ...current, date: defaultDate }));
  }, [defaultDate]);

  const activeBuckets = data.buckets ?? [];

  function openMovement(type, bucket) {
    setMovement({ type, bucket });
    setMovementForm({ value: '', date: defaultDate, observation: '', origin: 'balance' });
  }

  async function saveMovement() {
    const value = Number(movementForm.value);
    if (!Number.isFinite(value) || value <= 0) {
      toast.error('Informe um valor válido.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        bucketId: movement.bucket.id,
        value,
        date: movementForm.date,
        observation: movementForm.observation || undefined,
        ...(movement.type === 'deposit' ? { origin: movementForm.origin } : {}),
      };
      if (movement.type === 'deposit') await savingsApi.deposit(payload);
      else await savingsApi.withdraw(payload);
      toast.success(movement.type === 'deposit' ? 'Valor guardado na caixinha!' : 'Valor devolvido ao saldo disponível!');
      setMovement(null);
      await load();
    } catch (error) {
      toast.error(extractErrorMessage(error, 'Não foi possível concluir a movimentação.'));
    } finally {
      setSaving(false);
    }
  }

  function openCreateBucket() {
    setBucketModal({ mode: 'create', bucket: null });
    setBucketForm({ kind: 'emergency', name: '', targetValue: '' });
  }

  function openEditBucket(bucket) {
    setBucketModal({ mode: 'edit', bucket });
    setBucketForm({
      kind: bucket.kind,
      name: bucket.name ?? '',
      targetValue: bucket.targetValue == null ? '' : String(bucket.targetValue),
    });
  }

  async function saveBucket() {
    const targetValue = bucketForm.targetValue === '' ? null : Number(bucketForm.targetValue);
    if (targetValue != null && (!Number.isFinite(targetValue) || targetValue <= 0)) {
      toast.error('A meta da caixinha precisa ser maior que zero.');
      return;
    }
    if (bucketForm.kind === 'custom' && !bucketForm.name.trim()) {
      toast.error('Informe um nome para a caixinha personalizada.');
      return;
    }
    setSaving(true);
    try {
      const payload = { kind: bucketForm.kind, name: bucketForm.name || null, targetValue };
      if (bucketModal.mode === 'create') await savingsApi.createBucket(payload);
      else await savingsApi.updateBucket(bucketModal.bucket.id, payload);
      toast.success(bucketModal.mode === 'create' ? 'Caixinha criada!' : 'Caixinha atualizada!');
      setBucketModal(null);
      await load();
    } catch (error) {
      toast.error(extractErrorMessage(error, 'Não foi possível salvar a caixinha.'));
    } finally {
      setSaving(false);
    }
  }

  function openTransfer(sourceBucket) {
    const destination = activeBuckets.find((bucket) => String(bucket.id) !== String(sourceBucket.id));
    if (!destination) {
      toast.error('Crie outra caixinha para realizar uma transferência.');
      return;
    }
    setTransferForm({
      fromBucketId: String(sourceBucket.id),
      toBucketId: String(destination.id),
      value: '',
      date: defaultDate,
      observation: '',
    });
    setTransferModal(true);
  }

  async function saveTransfer() {
    const value = Number(transferForm.value);
    if (!Number.isFinite(value) || value <= 0) {
      toast.error('Informe um valor válido.');
      return;
    }
    if (transferForm.fromBucketId === transferForm.toBucketId) {
      toast.error('Escolha duas caixinhas diferentes.');
      return;
    }
    setSaving(true);
    try {
      await savingsApi.transfer({ ...transferForm, value });
      toast.success('Transferência entre caixinhas concluída!');
      setTransferModal(false);
      await load();
    } catch (error) {
      toast.error(extractErrorMessage(error, 'Não foi possível transferir.'));
    } finally {
      setSaving(false);
    }
  }

  function openEditTx(transaction) {
    setEditTxForm({
      value: String(transaction.value),
      date: apiDateToInput(transaction.transactionDate),
      observation: transaction.observation ?? '',
      origin: transaction.origin ?? 'balance',
    });
    setEditTxModal(transaction);
  }

  async function saveEditTx() {
    const value = Number(editTxForm.value);
    if (!Number.isFinite(value) || value <= 0) {
      toast.error('Informe um valor válido.');
      return;
    }
    setSaving(true);
    try {
      await savingsApi.update(editTxModal.id, {
        value,
        date: editTxForm.date,
        observation: editTxForm.observation || undefined,
        ...(editTxModal.type === 'deposit' ? { origin: editTxForm.origin } : {}),
      });
      toast.success('Lançamento atualizado!');
      setEditTxModal(null);
      await load();
    } catch (error) {
      toast.error(extractErrorMessage(error, 'Erro ao atualizar.'));
    } finally {
      setSaving(false);
    }
  }

  async function deleteTransaction() {
    setDeleting(true);
    try {
      await savingsApi.delete(deleteTxTarget.id);
      toast.success('Lançamento excluído.');
      setDeleteTxTarget(null);
      await load();
    } catch (error) {
      toast.error(extractErrorMessage(error, 'Erro ao excluir.'));
    } finally {
      setDeleting(false);
    }
  }

  async function archiveBucket() {
    setDeleting(true);
    try {
      await savingsApi.archiveBucket(archiveTarget.id);
      toast.success('Caixinha arquivada.');
      setArchiveTarget(null);
      setBucketModal(null);
      await load();
    } catch (error) {
      toast.error(extractErrorMessage(error, 'Não foi possível arquivar.'));
    } finally {
      setDeleting(false);
    }
  }

  async function restoreBucket(bucket) {
    setSaving(true);
    try {
      await savingsApi.restoreBucket(bucket.id);
      toast.success('Caixinha restaurada.');
      await load();
    } catch (error) {
      toast.error(extractErrorMessage(error, 'Não foi possível restaurar.'));
    } finally {
      setSaving(false);
    }
  }

  const chartData = useMemo(() => [...(data.transactions ?? [])]
    .filter((transaction) => !(transaction.transferId && transaction.type === 'withdraw'))
    .reverse()
    .map((transaction) => ({
      label: formatShortDate(transaction.transactionDate),
      saldo: Number(transaction.balanceAfter),
    })), [data.transactions]);

  return (
    <div data-tutorial-page-ready={!loading ? 'savings' : undefined} className="space-y-6 animate-page-enter">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-success to-success-dark p-6 text-white">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute right-0 top-0 h-64 w-64 -translate-y-1/2 translate-x-1/2 rounded-full bg-white" />
          <div className="absolute bottom-0 left-0 h-48 w-48 -translate-x-1/2 translate-y-1/2 rounded-full bg-white" />
        </div>
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-1 text-sm font-medium text-white/70">Total nas caixinhas</p>
            <p className="responsive-money font-mono font-bold"><AnimatedNumber value={data.balance} formatter={formatCurrency} /></p>
            <p className="mt-2 text-xs text-white/65">O que sai do saldo disponível continua fazendo parte do seu patrimônio, agora separado por finalidade.</p>
          </div>
          <Button onClick={openCreateBucket} className="justify-center bg-white font-bold text-success-dark hover:bg-white/90">
            + Nova caixinha
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-52 rounded-3xl shimmer-bg" />)}</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {activeBuckets.map((bucket) => {
            const target = Number(bucket.targetValue ?? 0);
            const balance = Number(bucket.balance ?? 0);
            const progress = target > 0 ? Math.min((balance / target) * 100, 100) : null;
            return (
              <Card key={bucket.id} className="flex flex-col !p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-success-subtle text-xl">{bucketIcon(bucket)}</div>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-950 dark:text-white">{bucketName(bucket)}</p>
                      <p className="text-xs text-muted">{bucket.isDefault ? 'Caixinha principal' : 'Caixinha de reserva'}</p>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => openEditBucket(bucket)} aria-label="Editar caixinha">Editar</Button>
                </div>

                <p className="mt-5 font-mono text-2xl font-bold text-slate-950 dark:text-white">{formatCurrency(balance)}</p>
                {target > 0 ? (
                  <div className="mt-4">
                    <div className="mb-1.5 flex justify-between text-xs text-muted">
                      <span>{Math.round(progress)}% da meta</span>
                      <span>{formatCurrency(target)}</span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-subtle dark:bg-white/[0.06]">
                      <div className="h-full rounded-full bg-success transition-all" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                ) : <p className="mt-3 text-xs text-muted">Defina uma meta para acompanhar o progresso.</p>}

                <div className="mt-5 grid grid-cols-2 gap-2">
                  <Button onClick={() => openMovement('deposit', bucket)} className="justify-center">+ Guardar</Button>
                  <Button variant="outline" onClick={() => openMovement('withdraw', bucket)} disabled={balance <= 0} className="justify-center">Retirar</Button>
                  <Button variant="ghost" onClick={() => openTransfer(bucket)} disabled={balance <= 0 || activeBuckets.length < 2} className="col-span-2 justify-center">Transferir entre caixinhas</Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {(data.archivedBuckets ?? []).length > 0 && (
        <Card>
          <CardHeader title="Caixinhas arquivadas" subtitle="O histórico continua preservado" />
          <div className="space-y-2">
            {data.archivedBuckets.map((bucket) => (
              <div key={bucket.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-subtle p-3 dark:bg-white/[0.04]">
                <div className="flex items-center gap-3">
                  <span className="text-xl">{bucketIcon(bucket)}</span>
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-zinc-50">{bucketName(bucket)}</p>
                    <p className="text-xs text-muted">Saldo zerado · histórico mantido</p>
                  </div>
                </div>
                <Button size="sm" variant="outline" loading={saving} onClick={() => restoreBucket(bucket)}>Restaurar</Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {data.breakdown && (data.breakdown.movedFromBalance > 0 || data.breakdown.externalReported > 0) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Card className="!p-4">
            <p className="mb-1 text-xs text-muted">Transferido do saldo disponível</p>
            <p className="font-mono text-lg font-bold text-slate-900 dark:text-zinc-50">{formatCurrency(data.breakdown.movedFromBalance)}</p>
          </Card>
          <Card className="!p-4">
            <p className="mb-1 text-xs text-muted">Informado como já guardado</p>
            <p className="font-mono text-lg font-bold text-slate-900 dark:text-zinc-50">{formatCurrency(data.breakdown.externalReported)}</p>
          </Card>
        </div>
      )}

      {chartData.length > 1 && (
        <Card>
          <CardHeader title="Evolução de todas as reservas" />
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
                <YAxis tick={{ fontSize: 11, fill: axisColor }} axisLine={false} tickLine={false} tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="saldo" stroke="#16A34A" strokeWidth={2.5} fill="url(#saldoGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      <Card padding={false}>
        <div className="border-b border-border px-5 py-4 dark:border-white/[0.06]">
          <h3 className="font-semibold text-slate-900 dark:text-zinc-50">Histórico das caixinhas</h3>
          <p className="mt-0.5 text-xs text-muted">Depósitos vindos do saldo reduzem o caixa livre; retiradas devolvem o valor. Transferências internas não alteram o Dashboard.</p>
        </div>
        {loading ? (
          <div className="space-y-3 p-5">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-10 rounded-xl shimmer-bg" />)}</div>
        ) : data.transactions.length === 0 ? (
          <EmptyState icon="🏦" title="Sem movimentações" description="Escolha uma caixinha e faça o primeiro depósito." />
        ) : (
          <div className="data-table-scroll">
            <table className="responsive-stack-table w-full text-sm">
              <thead className="bg-subtle/60 dark:bg-white/[0.03]"><tr>
                {['Tipo', 'Caixinha', 'Valor', 'Saldo na caixinha', 'Data', 'Observação', ''].map((heading) => <th key={heading} className="table-header">{heading}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-border/60 dark:divide-white/[0.06]">
                {data.transactions.map((transaction, index) => {
                  const isTransfer = Boolean(transaction.transferId);
                  const isDeposit = transaction.type === 'deposit';
                  return (
                    <tr key={transaction.id} className="transition-colors hover:bg-subtle/40 dark:hover:bg-white/[0.03]">
                      <td data-label="Tipo" className="table-cell">
                        <Badge variant={isTransfer ? 'purple' : isDeposit ? 'success' : 'danger'}>
                          {isTransfer ? (isDeposit ? 'Transferência recebida' : 'Transferência enviada') : isDeposit ? 'Depósito' : 'Retirada'}
                        </Badge>
                      </td>
                      <td data-label="Caixinha" className="table-cell font-medium">{bucketName(transaction.bucket)}</td>
                      <td data-label="Valor" className={`table-cell font-mono font-bold tabular-nums ${isDeposit ? 'text-success-dark dark:text-success-light' : 'text-danger-dark dark:text-danger-light'}`}>
                        {isDeposit ? '+' : '-'}{formatCurrency(transaction.value)}
                      </td>
                      <td data-label="Saldo na caixinha" className="table-cell font-mono tabular-nums text-slate-600 dark:text-zinc-400">{formatCurrency(transaction.bucketBalanceAfter)}</td>
                      <td data-label="Data" className="table-cell text-muted">{formatShortDate(transaction.transactionDate)}</td>
                      <td data-label="Observação" className="table-cell text-muted">{transaction.observation ?? '—'}</td>
                      <td data-label="Ações" className="table-cell">
                        {index === 0 && !isTransfer && (
                          <div className="flex items-center justify-end gap-2">
                            <Button size="sm" variant="ghost" onClick={() => openEditTx(transaction)}>Editar</Button>
                            <Button size="sm" variant="ghost" className="text-danger" onClick={() => setDeleteTxTarget(transaction)}>Excluir</Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={Boolean(movement)} onClose={() => setMovement(null)} title={movement ? `${movement.type === 'deposit' ? 'Guardar em' : 'Retirar de'} ${bucketName(movement.bucket)}` : ''} size="sm">
        <div className="space-y-4">
          {movement?.type === 'deposit' && (
            <>
              <FormGroup label="De onde vem esse valor?" required>
                <ChoiceCards compact columns={2} value={movementForm.origin} onChange={(origin) => setMovementForm({ ...movementForm, origin })} options={[
                  { value: 'balance', label: 'Saldo disponível', description: 'Sai do Dashboard agora.', icon: '↘', tone: 'choice-card-icon-primary' },
                  { value: 'external', label: 'Valor externo', description: 'Já estava guardado fora.', icon: '＋', tone: 'choice-card-icon-success' },
                ]} />
              </FormGroup>
              <div className="rounded-xl border border-success/20 bg-success-subtle p-3 text-xs text-success-dark dark:bg-success/10 dark:text-success-light">
                {movementForm.origin === 'balance'
                  ? 'O valor será descontado do saldo disponível e continuará somando no total das suas reservas.'
                  : 'O valor será registrado na caixinha sem alterar o saldo disponível.'}
              </div>
            </>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormGroup label="Valor" required><Input type="number" min="0" step="0.01" value={movementForm.value} onChange={(event) => setMovementForm({ ...movementForm, value: event.target.value })} /></FormGroup>
            <FormGroup label="Data"><Input type="date" min={selectedMonthDateRange.min} max={selectedMonthDateRange.max} value={movementForm.date} onChange={(event) => setMovementForm({ ...movementForm, date: event.target.value })} /></FormGroup>
          </div>
          <FormGroup label="Observação"><Input value={movementForm.observation} onChange={(event) => setMovementForm({ ...movementForm, observation: event.target.value })} placeholder="Opcional" /></FormGroup>
          <div className="modal-actions">
            <Button variant="outline" onClick={() => setMovement(null)}>Cancelar</Button>
            <Button variant={movement?.type === 'deposit' ? 'primary' : 'danger'} onClick={saveMovement} loading={saving}>{movement?.type === 'deposit' ? 'Guardar' : 'Retirar'}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={Boolean(bucketModal)} onClose={() => setBucketModal(null)} title={bucketModal?.mode === 'create' ? 'Nova caixinha' : 'Editar caixinha'} size="md">
        <div className="space-y-4">
          <FormGroup label="Finalidade" required>
            <ChoiceCards columns={2} value={bucketForm.kind} onChange={(kind) => setBucketForm({ ...bucketForm, kind })} options={bucketModal?.bucket?.isDefault ? [GENERAL_BUCKET_KIND, ...BUCKET_KINDS] : BUCKET_KINDS} />
          </FormGroup>
          <FormGroup label="Nome personalizado">
            <Input value={bucketForm.name} onChange={(event) => setBucketForm({ ...bucketForm, name: event.target.value })} placeholder={bucketForm.kind === 'custom' ? 'Ex.: Minha empresa' : 'Opcional'} />
          </FormGroup>
          <FormGroup label="Meta de valor">
            <Input type="number" min="0" step="0.01" value={bucketForm.targetValue} onChange={(event) => setBucketForm({ ...bucketForm, targetValue: event.target.value })} placeholder="Opcional" />
          </FormGroup>
          <div className="modal-actions flex-wrap">
            {bucketModal?.mode === 'edit' && !bucketModal.bucket?.isDefault && (
              <Button
                variant="ghost"
                className="mr-auto text-danger"
                disabled={Number(bucketModal.bucket?.balance ?? 0) > 0}
                title={Number(bucketModal.bucket?.balance ?? 0) > 0 ? 'Transfira ou retire todo o saldo antes de arquivar.' : 'Arquivar caixinha'}
                onClick={() => setArchiveTarget(bucketModal.bucket)}
              >
                Arquivar
              </Button>
            )}
            <Button variant="outline" onClick={() => setBucketModal(null)}>Cancelar</Button>
            <Button onClick={saveBucket} loading={saving}>Salvar caixinha</Button>
          </div>
        </div>
      </Modal>

      <Modal open={transferModal} onClose={() => setTransferModal(false)} title="Transferir entre caixinhas" size="sm">
        <div className="space-y-4">
          <FormGroup label="Caixinha de origem" required>
            <Select value={transferForm.fromBucketId} onChange={(event) => setTransferForm({ ...transferForm, fromBucketId: event.target.value })}>
              {activeBuckets.map((bucket) => <option key={bucket.id} value={bucket.id}>{bucketName(bucket)} — {formatCurrency(bucket.balance)}</option>)}
            </Select>
          </FormGroup>
          <FormGroup label="Caixinha de destino" required>
            <Select value={transferForm.toBucketId} onChange={(event) => setTransferForm({ ...transferForm, toBucketId: event.target.value })}>
              {activeBuckets.filter((bucket) => String(bucket.id) !== String(transferForm.fromBucketId)).map((bucket) => <option key={bucket.id} value={bucket.id}>{bucketName(bucket)}</option>)}
            </Select>
          </FormGroup>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormGroup label="Valor" required><Input type="number" min="0" step="0.01" value={transferForm.value} onChange={(event) => setTransferForm({ ...transferForm, value: event.target.value })} /></FormGroup>
            <FormGroup label="Data"><Input type="date" min={selectedMonthDateRange.min} max={selectedMonthDateRange.max} value={transferForm.date} onChange={(event) => setTransferForm({ ...transferForm, date: event.target.value })} /></FormGroup>
          </div>
          <FormGroup label="Observação"><Input value={transferForm.observation} onChange={(event) => setTransferForm({ ...transferForm, observation: event.target.value })} placeholder="Opcional" /></FormGroup>
          <div className="rounded-xl border border-border bg-subtle p-3 text-xs text-muted dark:border-white/[0.07] dark:bg-white/[0.035]">
            A transferência apenas reorganiza sua reserva. O saldo disponível e o total guardado não mudam.
          </div>
          <div className="modal-actions">
            <Button variant="outline" onClick={() => setTransferModal(false)}>Cancelar</Button>
            <Button onClick={saveTransfer} loading={saving}>Transferir</Button>
          </div>
        </div>
      </Modal>

      <Modal open={Boolean(editTxModal)} onClose={() => setEditTxModal(null)} title={`Editar ${editTxModal?.type === 'deposit' ? 'depósito' : 'retirada'}`} size="sm">
        <div className="space-y-4">
          {editTxModal?.type === 'deposit' && (
            <FormGroup label="Origem do valor">
              <Select value={editTxForm.origin} onChange={(event) => setEditTxForm({ ...editTxForm, origin: event.target.value })}>
                <option value="balance">Saldo disponível</option>
                <option value="external">Valor externo</option>
              </Select>
            </FormGroup>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormGroup label="Valor" required><Input type="number" min="0" step="0.01" value={editTxForm.value} onChange={(event) => setEditTxForm({ ...editTxForm, value: event.target.value })} /></FormGroup>
            <FormGroup label="Data"><Input type="date" min={selectedMonthDateRange.min} max={selectedMonthDateRange.max} value={editTxForm.date} onChange={(event) => setEditTxForm({ ...editTxForm, date: event.target.value })} /></FormGroup>
          </div>
          <FormGroup label="Observação"><Input value={editTxForm.observation} onChange={(event) => setEditTxForm({ ...editTxForm, observation: event.target.value })} placeholder="Opcional" /></FormGroup>
          <div className="modal-actions">
            <Button variant="outline" onClick={() => setEditTxModal(null)}>Cancelar</Button>
            <Button onClick={saveEditTx} loading={saving}>Salvar alteração</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTxTarget)}
        onClose={() => setDeleteTxTarget(null)}
        onConfirm={deleteTransaction}
        loading={deleting}
        title="Excluir lançamento"
        confirmLabel="Excluir"
        description={`Excluir este ${deleteTxTarget?.type === 'deposit' ? 'depósito' : 'saque'} de ${formatCurrency(deleteTxTarget?.value ?? 0)} da caixinha ${bucketName(deleteTxTarget?.bucket)}?`}
      />

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        onClose={() => setArchiveTarget(null)}
        onConfirm={archiveBucket}
        loading={deleting}
        title="Arquivar caixinha"
        confirmLabel="Arquivar"
        description={`Arquivar a caixinha ${bucketName(archiveTarget)}? Ela precisa estar zerada e seu histórico será preservado.`}
      />
    </div>
  );
}
