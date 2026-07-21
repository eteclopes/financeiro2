import { useState, useEffect, useCallback } from 'react';
import { useMonthStore } from '../store/monthStore';
import { categoriesApi } from '../lib/services';
import { extractErrorMessage } from '../lib/api';
import { formatCurrency } from '../lib/format';
import { Card, CardHeader, Badge, Button, EmptyState, Skeleton, ProgressBar } from '../components/ui/index';
import { Modal, FormGroup, Input, Select } from '../components/ui/Modal';
import { useUIStore } from '../store/uiStore';

export default function BudgetsPage() {
  const selectedMonthId = useMonthStore((s) => s.selectedMonthId);
  const [categories, setCategories] = useState([]);
  const [budgets, setBudgets]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [modalOpen, setModalOpen]   = useState(false);
  const [isEditing, setIsEditing]   = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [limitValue, setLimitValue] = useState('');
  const [saving, setSaving]         = useState(false);
  const toast = useUIStore((s) => s);

  const load = useCallback(async () => {
    if (!selectedMonthId) return;
    setLoading(true);
    try {
      const [catsRes, budgetsRes] = await Promise.all([
        categoriesApi.list('expense'),
        categoriesApi.budgets(selectedMonthId),
      ]);
      setCategories(catsRes.data.categories ?? []);
      setBudgets(budgetsRes.data.budgets ?? []);
    } catch { toast.error('Erro ao carregar orçamentos.'); }
    finally { setLoading(false); }
  }, [selectedMonthId]);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setIsEditing(false);
    setCategoryId('');
    setLimitValue('');
    setModalOpen(true);
  }

  function openEdit(budget) {
    setIsEditing(true);
    setCategoryId(budget.categoryId);
    setLimitValue(String(budget.monthlyLimit));
    setModalOpen(true);
  }

  async function handleSave() {
    if (!categoryId || !limitValue || Number(limitValue) <= 0) {
      toast.error('Escolha uma categoria e um valor de limite maior que zero.');
      return;
    }
    setSaving(true);
    try {
      await categoriesApi.updateLimit(categoryId, Number(limitValue));
      toast.success('Orçamento salvo.');
      setModalOpen(false);
      load();
    } catch (e) { toast.error(extractErrorMessage(e, 'Erro ao salvar orçamento.')); }
    finally { setSaving(false); }
  }

  async function handleRemoveLimit(budget) {
    try {
      await categoriesApi.updateLimit(budget.categoryId, null);
      toast.success('Limite removido.');
      load();
    } catch (e) { toast.error(extractErrorMessage(e, 'Erro ao remover limite.')); }
  }

  const categoriesWithoutBudget = categories.filter(
    (c) => !budgets.some((b) => b.categoryId === String(c.id))
  );

  const totalLimit = budgets.reduce((s, b) => s + b.monthlyLimit, 0);
  const totalSpent = budgets.reduce((s, b) => s + b.spent, 0);

  return (
    <div className="space-y-5 animate-page-enter">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-[-0.025em] text-slate-950 dark:text-white">Orçamento por Categoria</h2>
          <p className="text-sm text-muted mt-0.5">Defina limites mensais e acompanhe quanto já gastou em cada categoria</p>
        </div>
        <Button onClick={openCreate}>+ Definir orçamento</Button>
      </div>

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : budgets.length === 0 ? (
        <Card>
          <EmptyState icon="🎯" title="Nenhum orçamento definido"
            description="Defina um limite mensal para uma categoria de despesa e acompanhe seu progresso aqui."
            action={<Button onClick={openCreate}>Definir orçamento</Button>} />
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader title="Resumo geral" />
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-muted">Gasto total nas categorias com orçamento</span>
              <span className="font-mono font-bold">{formatCurrency(totalSpent)} <span className="text-muted font-normal">/ {formatCurrency(totalLimit)}</span></span>
            </div>
            <ProgressBar value={totalSpent} max={totalLimit || 1} color={totalSpent > totalLimit ? 'danger' : 'primary'} />
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {budgets.map((b) => (
              <Card key={b.categoryId}>
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="font-semibold text-slate-900 dark:text-zinc-50">{b.categoryName}</h3>
                    <p className="text-xs text-muted mt-0.5">
                      {formatCurrency(b.spent)} de {formatCurrency(b.monthlyLimit)}
                    </p>
                  </div>
                  {b.exceeded ? (
                    <Badge variant="danger">Estourou {(b.percentUsed - 100).toFixed(0)}%</Badge>
                  ) : b.percentUsed >= 80 ? (
                    <Badge variant="warning">{b.percentUsed.toFixed(0)}%</Badge>
                  ) : (
                    <Badge variant="success">{b.percentUsed.toFixed(0)}%</Badge>
                  )}
                </div>
                <ProgressBar value={b.spent} max={b.monthlyLimit} color={b.exceeded ? 'danger' : b.percentUsed >= 80 ? 'warning' : 'primary'} />
                <div className="flex flex-wrap gap-2 mt-3">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(b)}>Editar limite</Button>
                  <Button variant="ghost" size="sm" className="text-danger" onClick={() => handleRemoveLimit(b)}>Remover</Button>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Definir orçamento" size="md">
        <div className="space-y-4">
          <FormGroup label="Categoria" required>
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={isEditing}>
              <option value="">Selecione...</option>
              {(isEditing ? categories : categoriesWithoutBudget).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </FormGroup>
          <FormGroup label="Limite mensal (R$)" required>
            <Input type="number" min="0.01" step="0.01" value={limitValue}
              onChange={(e) => setLimitValue(e.target.value)} placeholder="Ex: 800,00" />
          </FormGroup>
          <div className="modal-actions">
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} loading={saving}>Salvar</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
