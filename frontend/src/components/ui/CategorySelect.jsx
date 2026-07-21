import { useState } from 'react';
import { Select, Input } from './Modal';
import { categoriesApi } from '../../lib/services';

const NEW_CATEGORY_VALUE = '__new__';

/**
 * Substituto do <Select> simples para escolher categoria: além das
 * categorias já existentes, mostra uma opção fixa "+ Nova categoria..."
 * no final da lista. Ao escolhê-la, troca o dropdown por um campo de
 * texto + botões (Criar / Cancelar) no próprio lugar — sem precisar sair
 * do formulário ou ir em outra tela cadastrar a categoria antes.
 *
 * Ao criar com sucesso, chama onCategoryCreated(novaCategoria) (para o
 * componente pai atualizar a lista `categories` em memória) e já seleciona
 * a categoria recém-criada via onChange, mantendo o mesmo formato de
 * evento sintético que o restante do app usa: (e) => e.target.value.
 */
export function CategorySelect({ value, onChange, categories, type, onCategoryCreated, placeholder = 'Selecione...' }) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function handleSelectChange(e) {
    if (e.target.value === NEW_CATEGORY_VALUE) {
      setCreating(true);
      setNewName('');
      setError('');
      return;
    }
    onChange(e);
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) {
      setError('Digite um nome para a categoria.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const { data } = await categoriesApi.create({ name, type });
      const created = data.category ?? data;
      onCategoryCreated?.(created);
      onChange({ target: { value: String(created.id) } });
      setCreating(false);
      setNewName('');
    } catch (err) {
      setError(err?.response?.data?.message ?? 'Não foi possível criar a categoria.');
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setCreating(false);
    setNewName('');
    setError('');
  }

  if (creating) {
    return (
      <div>
        <div className="flex gap-2">
          <Input
            autoFocus
            placeholder="Nome da nova categoria"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); handleCreate(); }
              if (e.key === 'Escape') handleCancel();
            }}
            className="flex-1"
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={saving}
            className="px-3 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-50 shrink-0"
          >
            {saving ? '...' : 'Criar'}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            disabled={saving}
            className="px-3 rounded-lg border border-border dark:border-white/10 text-sm text-muted shrink-0"
          >
            Cancelar
          </button>
        </div>
        {error && <p className="mt-1.5 text-xs text-danger">⚠ {error}</p>}
      </div>
    );
  }

  return (
    <Select value={value} onChange={handleSelectChange} placeholder={placeholder}>
      {categories.map((c) => (
        <option key={c.id} value={c.id}>{c.name}</option>
      ))}
      <option value={NEW_CATEGORY_VALUE}>+ Nova categoria...</option>
    </Select>
  );
}