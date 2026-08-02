import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useAuthStore } from '../store/authStore';
import { extractErrorMessage } from '../lib/api';
import { useUIStore } from '../store/uiStore';
import { PageHeader, Card, CardHeader, Button, Badge, AlertBanner } from '../components/ui';
import { FormGroup, Input, Select, ConfirmDialog } from '../components/ui/Modal';

function currentParts() {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

export default function WorkspacesPage() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const simulations = useWorkspaceStore((state) => state.simulations);
  const activeId = useWorkspaceStore((state) => state.activeId);
  const switchWorkspace = useWorkspaceStore((state) => state.switchWorkspace);
  const createWorkspace = useWorkspaceStore((state) => state.createWorkspace);
  const deleteWorkspace = useWorkspaceStore((state) => state.deleteWorkspace);
  const toast = useUIStore((state) => state);
  const now = useMemo(currentParts, []);
  const [form, setForm] = useState({
    name: `Planejamento ${now.year + 1}`,
    startMonth: 1,
    startYear: now.year + 1,
    copySetup: true,
    initialBalance: 0,
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await createWorkspace({
        ...form,
        startMonth: Number(form.startMonth),
        startYear: Number(form.startYear),
        initialBalance: Number(form.initialBalance || 0),
      });
      toast.success('Simulação criada e ativada.');
      navigate('/dashboard');
    } catch (error) {
      toast.error(extractErrorMessage(error, 'Não foi possível criar a simulação.'));
    } finally {
      setSaving(false);
    }
  }

  async function activate(id) {
    await switchWorkspace(id);
    navigate('/dashboard');
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(deleteTarget.id);
    try {
      await deleteWorkspace(deleteTarget.id);
      toast.success('Simulação excluída.');
      setDeleteTarget(null);
    } catch (error) {
      toast.error(extractErrorMessage(error, 'Não foi possível excluir a simulação.'));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Ambientes financeiros"
        title="Real e Simulações"
        description="Use o financeiro real para o dia a dia e crie cenários separados para testar janeiro a dezembro sem alterar nenhum dado verdadeiro."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-success/20">
          <CardHeader
            title="Financeiro real"
            subtitle="Histórico oficial da sua conta"
            actions={<Badge variant={activeId === 'real' ? 'success' : 'default'}>{activeId === 'real' ? 'ATIVO' : 'REAL'}</Badge>}
          />
          <div className="space-y-3 text-sm text-muted">
            <p>Os meses anteriores são encerrados automaticamente quando o calendário do seu dispositivo entra em um novo mês.</p>
            <p>Não existe botão manual de fechamento. O histórico encerrado permanece protegido contra alterações retroativas.</p>
          </div>
          {activeId !== 'real' && (
            <Button className="mt-5" onClick={() => activate('real')}>Entrar no financeiro real</Button>
          )}
        </Card>

        <Card>
          <CardHeader title="Nova simulação" subtitle={user?.isPro ? 'Plano Pro: até 10 cenários ativos' : 'Plano Básico: 1 cenário ativo'} />
          <form className="space-y-4" onSubmit={submit}>
            <FormGroup label="Nome da simulação" required>
              <Input value={form.name} maxLength={100} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </FormGroup>
            <div className="grid grid-cols-2 gap-3">
              <FormGroup label="Mês inicial">
                <Select value={form.startMonth} onChange={(event) => setForm({ ...form, startMonth: event.target.value })}>
                  {Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{String(index + 1).padStart(2, '0')}</option>)}
                </Select>
              </FormGroup>
              <FormGroup label="Ano inicial">
                <Input type="number" min="2000" max="2200" value={form.startYear} onChange={(event) => setForm({ ...form, startYear: event.target.value })} />
              </FormGroup>
            </div>
            <FormGroup label="Saldo inicial da simulação">
              <Input
                type="number"
                step="0.01"
                value={form.initialBalance}
                onChange={(event) => setForm({ ...form, initialBalance: event.target.value })}
              />
              <p className="mt-1 text-xs text-muted">Use o saldo com que o cenário deve começar. Ele nunca altera o financeiro real.</p>
            </FormGroup>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 text-sm dark:border-white/[0.08]">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-primary"
                checked={form.copySetup}
                onChange={(event) => setForm({ ...form, copySetup: event.target.checked })}
              />
              <span>
                <strong className="block text-slate-800 dark:text-zinc-100">Copiar minha estrutura atual</strong>
                <span className="text-muted">Leva cartões, receitas recorrentes, despesas fixas, categorias e dívidas ativas. Não copia movimentações reais já realizadas.</span>
              </span>
            </label>
            <Button type="submit" loading={saving}>Criar e abrir simulação</Button>
          </form>
        </Card>
      </div>

      <AlertBanner type="info">
        Em uma simulação, você pode fechar meses manualmente, reabrir um mês antigo e recalcular os seguintes. Nenhum lançamento simulado entra no saldo real.
      </AlertBanner>

      <Card>
        <CardHeader title="Minhas simulações" subtitle={`${simulations.length} cenário(s) ativo(s)`} />
        {simulations.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">Nenhuma simulação criada ainda.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {simulations.map((workspace) => {
              const active = String(activeId) === String(workspace.id);
              return (
                <div key={workspace.id} className={`rounded-2xl border p-4 ${active ? 'border-primary/40 bg-primary-subtle dark:bg-primary/10' : 'border-slate-200 dark:border-white/[0.08]'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold text-slate-900 dark:text-white">{workspace.name}</p>
                      <p className="mt-1 text-xs text-muted">Início: {String(workspace.startMonth).padStart(2, '0')}/{workspace.startYear}</p>
                      <p className="mt-1 text-xs text-muted">Data simulada: {workspace.currentDate ? new Date(workspace.currentDate).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—'}</p>
                    </div>
                    <Badge variant={active ? 'purple' : 'default'}>{active ? 'ATIVA' : 'SIMULAÇÃO'}</Badge>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {!active && <Button size="sm" onClick={() => activate(workspace.id)}>Abrir</Button>}
                    <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(workspace)} disabled={deleting === workspace.id}>Excluir</Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Excluir simulação"
        description={`A simulação “${deleteTarget?.name || ''}” e todos os dados dela serão apagados. O financeiro real não será alterado.`}
        confirmLabel="Excluir simulação"
        loading={Boolean(deleting)}
      />
    </div>
  );
}
