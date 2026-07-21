import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useTutorialStore } from '../store/tutorialStore';
import { categoriesApi } from '../lib/services';
import { extractErrorMessage } from '../lib/api';
import { Card, CardHeader, Badge, Button } from '../components/ui/index';
import { Modal, FormGroup, Input, Select } from '../components/ui/Modal';
import { useUIStore } from '../store/uiStore';
import { useThemeStore } from '../store/themeStore';
import { ChoiceCards, SegmentedControl } from '../components/ui/Motion';

export default function SettingsPage() {
  const user  = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const toast = useUIStore((s) => s);
  const navigate = useNavigate();
  const startTutorial = useTutorialStore((s) => s.start);
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const [catType, setCatType]     = useState('expense');
  const [categories, setCategories] = useState([]);
  const [catName, setCatName]     = useState('');
  const [savingCat, setSavingCat] = useState(false);
  const [editingCatId, setEditingCatId]     = useState(null);
  const [editingCatName, setEditingCatName] = useState('');
  const [renamingCat, setRenamingCat]       = useState(false);
  const [editNameModal, setEditNameModal] = useState(false);
  const [nameForm, setNameForm]           = useState('');
  const [savingName, setSavingName]       = useState(false);

  function openEditName() {
    setNameForm(user?.name ?? '');
    setEditNameModal(true);
  }

  async function saveEditName() {
    const name = nameForm.trim();
    if (name.length < 2) { toast.error('Nome muito curto.'); return; }
    setSavingName(true);
    try {
      await updateProfile(name);
      toast.success('Nome atualizado!');
      setEditNameModal(false);
    } catch (e) { toast.error(extractErrorMessage(e, 'Erro ao atualizar nome.')); }
    finally { setSavingName(false); }
  }

  async function loadCats() {
    try { const r = await categoriesApi.list(catType); setCategories(r.data.categories ?? []); }
    catch { toast.error('Erro ao carregar categorias.'); }
  }

  useEffect(() => { loadCats(); }, [catType]);

  async function saveCategory() {
    if (!catName.trim()) { toast.error('Informe o nome da categoria.'); return; }
    setSavingCat(true);
    try {
      await categoriesApi.create({ name: catName.trim(), type: catType });
      toast.success('Categoria criada!'); setCatName(''); loadCats();
    } catch (e) { toast.error(extractErrorMessage(e, 'Erro.')); }
    finally { setSavingCat(false); }
  }

  async function deleteCategory(id) {
    try { await categoriesApi.delete(id); toast.success('Categoria removida.'); loadCats(); }
    catch (e) { toast.error(extractErrorMessage(e, 'Categoria em uso ou não encontrada.')); }
  }

  function startRename(cat) { setEditingCatId(cat.id); setEditingCatName(cat.name); }
  function cancelRename() { setEditingCatId(null); setEditingCatName(''); }

  async function saveRename(id) {
    const name = editingCatName.trim();
    if (!name) { toast.error('Informe um nome.'); return; }
    setRenamingCat(true);
    try {
      await categoriesApi.rename(id, name);
      toast.success('Categoria renomeada!');
      cancelRename(); loadCats();
    } catch (e) { toast.error(extractErrorMessage(e, 'Erro ao renomear.')); }
    finally { setRenamingCat(false); }
  }

  const userCats    = categories.filter((c) => c.userId != null);
  const defaultCats = categories.filter((c) => c.userId == null);

  return (
    <div className="space-y-5 max-w-2xl animate-fade-in">
      <h2 className="text-2xl font-bold tracking-[-0.025em] text-slate-950 dark:text-white">Configurações</h2>

      {/* Perfil */}
      <Card>
        <CardHeader title="Perfil" />
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 bg-gradient-to-br from-primary to-primary-dark rounded-2xl flex items-center justify-center text-white text-2xl font-bold shadow-md shrink-0">
            {user?.name?.[0]?.toUpperCase() ?? 'U'}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="font-bold text-slate-900 dark:text-zinc-50 text-lg">{user?.name}</p>
              <button onClick={openEditName} className="text-xs text-primary-dark dark:text-primary-light hover:underline">
                Editar
              </button>
            </div>
            <p className="text-sm text-muted">{user?.email}</p>
            <Badge variant="success" className="mt-1.5">Conta ativa</Badge>
          </div>
        </div>
      </Card>


      {/* Aparência */}
      <Card>
        <CardHeader title="Aparência" subtitle="Escolha o tema que combina melhor com o ambiente." />
        <ChoiceCards columns={2} value={theme} onChange={setTheme} options={[
          { value:'light', label:'Modo claro', description:'Limpo, leve e com bastante contraste.', icon:'☀', tone:'choice-card-icon-warning' },
          { value:'dark', label:'Modo escuro', description:'Profundo, confortável e com brilho neon.', icon:'◐', tone:'choice-card-icon-primary' },
        ]} />
      </Card>

      {/* Editar nome */}
      <Modal open={editNameModal} onClose={() => setEditNameModal(false)} title="Editar Nome" size="sm">
        <div className="space-y-4">
          <FormGroup label="Nome" required>
            <Input value={nameForm} onChange={(e) => setNameForm(e.target.value)} autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') saveEditName(); }} />
          </FormGroup>
          <p className="text-xs text-muted">O e-mail não pode ser alterado por aqui.</p>
          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={() => setEditNameModal(false)}>Cancelar</Button>
            <Button onClick={saveEditName} loading={savingName}>Salvar</Button>
          </div>
        </div>
      </Modal>

      {/* Senha */}
      <Card>
        <CardHeader title="Alterar Senha" subtitle="A troca exige verificação por e-mail por segurança." />
        <div className="bg-info-subtle dark:bg-info/10 border border-info/20 rounded-xl p-4 text-sm text-info-dark dark:text-info-light mb-4">
          ℹ Para alterar sua senha, use a opção <strong>"Esqueci minha senha"</strong> na tela de login. Um link de redefinição será enviado para <strong>{user?.email}</strong>.
        </div>
        <Button variant="outline" onClick={() => window.location.href = '/forgot-password'}>
          Ir para redefinição de senha →
        </Button>
      </Card>

      {/* Ajuda */}
      <Card>
        <CardHeader title="Ajuda" subtitle="Precisa relembrar como alguma parte do app funciona?" />
        <Button data-tutorial="tutorial-replay-button" variant="outline" onClick={() => { navigate('/dashboard'); startTutorial(); }}>
          🔁 Ver tutorial novamente
        </Button>
      </Card>

      {/* Categorias personalizadas */}
      <Card>
        <CardHeader title="Categorias Personalizadas" />

        <SegmentedControl className="mb-5" value={catType} onChange={setCatType} options={[
          { value:'expense', label:'Despesas', icon:'↘' },
          { value:'income', label:'Receitas', icon:'↗' },
        ]} />

        {/* Nova categoria */}
        <div className="flex gap-2 mb-5">
          <Input value={catName} onChange={(e) => setCatName(e.target.value)}
            placeholder={`Nome da nova categoria de ${catType === 'expense' ? 'despesa' : 'receita'}...`}
            className="flex-1"
            onKeyDown={(e) => e.key === 'Enter' && saveCategory()} />
          <Button onClick={saveCategory} loading={savingCat}>Criar</Button>
        </div>

        {/* Suas categorias */}
        {userCats.length > 0 && (
          <div className="mb-5">
            <p className="text-xs font-bold text-slate-500 dark:text-zinc-500 uppercase tracking-wider mb-2">Suas categorias</p>
            <div className="flex flex-wrap gap-2">
              {userCats.map((cat) => (
                editingCatId === cat.id ? (
                  <div key={cat.id} className="flex items-center gap-1 bg-white dark:bg-panel-dark border border-primary/40 rounded-xl pl-2 pr-1.5 py-1.5">
                    <input
                      autoFocus
                      value={editingCatName}
                      onChange={(e) => setEditingCatName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveRename(cat.id); if (e.key === 'Escape') cancelRename(); }}
                      className="text-sm font-medium bg-transparent outline-none w-32 text-slate-700 dark:text-zinc-300"
                    />
                    <button onClick={() => saveRename(cat.id)} disabled={renamingCat}
                      className="h-5 w-5 rounded-lg hover:bg-primary-subtle dark:hover:bg-primary/20 text-muted hover:text-primary-dark flex items-center justify-center text-xs transition-colors">
                      ✓
                    </button>
                    <button onClick={cancelRename} disabled={renamingCat}
                      className="h-5 w-5 rounded-lg hover:bg-danger-muted dark:hover:bg-danger/20 text-muted hover:text-danger flex items-center justify-center text-sm transition-colors">
                      ×
                    </button>
                  </div>
                ) : (
                  <div key={cat.id} className="flex items-center gap-1 bg-subtle dark:bg-white/[0.04] border border-border dark:border-white/10 rounded-xl pl-3 pr-1.5 py-1.5">
                    <span className="text-sm text-slate-700 dark:text-zinc-300 font-medium">{cat.name}</span>
                    <button onClick={() => startRename(cat)} title="Renomear"
                      className="h-5 w-5 rounded-lg hover:bg-primary-subtle dark:hover:bg-primary/20 text-muted hover:text-primary-dark flex items-center justify-center text-xs transition-colors ml-1">
                      ✎
                    </button>
                    <button onClick={() => deleteCategory(cat.id)} title="Excluir"
                      className="h-5 w-5 rounded-lg hover:bg-danger-muted dark:hover:bg-danger/20 text-muted hover:text-danger flex items-center justify-center text-sm transition-colors">
                      ×
                    </button>
                  </div>
                )
              ))}
            </div>
          </div>
        )}

        {/* Categorias padrão */}
        <div>
          <p className="text-xs font-bold text-slate-500 dark:text-zinc-500 uppercase tracking-wider mb-2">Categorias padrão do sistema</p>
          <div className="flex flex-wrap gap-2">
            {defaultCats.map((cat) => (
              <span key={cat.id} className="text-xs bg-white dark:bg-panel-dark border border-border dark:border-white/10 text-muted px-3 py-1.5 rounded-xl font-medium">
                {cat.name}
              </span>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}