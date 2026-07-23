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
import {
  CURRENCY_OPTIONS, LANGUAGE_OPTIONS, REGION_OPTIONS, TIME_ZONE_OPTIONS, useLocaleStore,
} from '../store/localeStore';

export default function SettingsPage() {
  const user  = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const toast = useUIStore((s) => s);
  const navigate = useNavigate();
  const requestTutorial = useTutorialStore((s) => s.request);
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const language = useLocaleStore((s) => s.language);
  const locale = useLocaleStore((s) => s.locale);
  const currency = useLocaleStore((s) => s.currency);
  const timeZone = useLocaleStore((s) => s.timeZone);
  const countryCode = useLocaleStore((s) => s.countryCode);
  const preferenceMode = useLocaleStore((s) => s.preferenceMode);
  const detectingLocale = useLocaleStore((s) => s.detecting);
  const setLanguage = useLocaleStore((s) => s.setLanguage);
  const setLocale = useLocaleStore((s) => s.setLocale);
  const setCurrency = useLocaleStore((s) => s.setCurrency);
  const setTimeZone = useLocaleStore((s) => s.setTimeZone);
  const detectAutomatically = useLocaleStore((s) => s.detectAutomatically);
  const [catType, setCatType]     = useState('expense');
  const [categories, setCategories] = useState([]);
  const [loadingCategories, setLoadingCategories] = useState(true);
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
    setLoadingCategories(true);
    try { const r = await categoriesApi.list(catType); setCategories(r.data.categories ?? []); }
    catch { toast.error('Erro ao carregar categorias.'); }
    finally { setLoadingCategories(false); }
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
    <div data-tutorial-page-ready={!loadingCategories ? 'settings' : undefined} className="space-y-5 max-w-3xl animate-fade-in">
      <h2 className="text-2xl font-bold tracking-[-0.025em] text-slate-950 dark:text-white">Configurações</h2>

      {/* Perfil */}
      <Card>
        <CardHeader title="Perfil" />
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <div className="h-16 w-16 bg-gradient-to-br from-primary to-primary-dark rounded-2xl flex items-center justify-center text-white text-2xl font-bold shadow-md shrink-0">
            {user?.name?.[0]?.toUpperCase() ?? 'U'}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <p className="min-w-0 break-words font-bold text-slate-900 dark:text-zinc-50 text-lg">{user?.name}</p>
              <button onClick={openEditName} className="text-xs text-primary-dark dark:text-primary-light hover:underline">
                Editar
              </button>
            </div>
            <p className="truncate text-sm text-muted">{user?.email}</p>
            <Badge variant="success" className="mt-1.5">Conta ativa</Badge>
          </div>
        </div>
      </Card>


      {/* Plano */}
      <Card>
        <CardHeader
          title="Plano da conta"
          subtitle={user?.isPro ? 'Recursos avançados liberados.' : 'O Básico mantém o gestor completo; o Pro adiciona inteligência financeira.'}
          actions={<Badge variant={user?.isPro ? 'success' : 'default'}>{user?.isPro ? 'PRO VITALÍCIO' : 'PLANO BÁSICO'}</Badge>}
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">
            {user?.isPro
              ? 'Simuladores, tendências, recomendações, relatórios e calculadoras estão disponíveis.'
              : 'Você pode usar receitas, despesas, cartões, faturas, reserva, metas, histórico e orçamento normalmente.'}
          </p>
          <Button variant={user?.isPro ? 'outline' : 'primary'} onClick={() => navigate('/plan')}>
            {user?.isPro ? 'Ver detalhes' : 'Conhecer o Pro'}
          </Button>
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

      {/* Idioma, região, moeda e fuso */}
      <Card>
        <CardHeader
          title="Idioma e região"
          subtitle="O primeiro acesso usa o país da conexão, o idioma do navegador e o fuso do dispositivo. Você pode ajustar tudo manualmente."
          actions={countryCode ? <Badge variant="default">{countryCode}</Badge> : null}
        />

        <div className="space-y-5">
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-700 dark:text-zinc-200">Idioma</p>
                <p className="mt-0.5 text-xs text-muted">Escolha o idioma da interface. A alteração é aplicada imediatamente.</p>
              </div>
              <Badge variant="default">{language.toUpperCase()}</Badge>
            </div>

            <div role="radiogroup" aria-label="Idioma" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {LANGUAGE_OPTIONS.map((option) => {
                const selected = language === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setLanguage(option.value)}
                    className={`group relative flex min-h-16 items-center gap-3 rounded-xl border px-3 py-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${selected
                      ? 'border-primary/50 bg-primary-subtle text-primary-dark shadow-sm dark:border-primary/40 dark:bg-primary/10 dark:text-primary-light'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-primary/25 hover:bg-slate-50 dark:border-white/[0.08] dark:bg-white/[0.025] dark:text-zinc-200 dark:hover:bg-white/[0.045]'
                    }`}
                  >
                    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[10px] font-black tracking-wider ${selected
                      ? 'bg-primary text-white'
                      : 'bg-slate-100 text-slate-500 dark:bg-white/[0.07] dark:text-zinc-400'
                    }`}>
                      {option.value.toUpperCase()}
                    </span>
                    <span data-i18n-ignore="true" className="min-w-0 truncate text-sm font-semibold">{option.nativeLabel}</span>
                    {selected && <span aria-hidden="true" className="absolute right-2 top-2 grid h-4 w-4 place-items-center rounded-full bg-primary text-[9px] text-white">✓</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormGroup label="Região">
              <Select value={locale} onChange={(event) => setLocale(event.target.value)}>
                {REGION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label} · {option.example}</option>)}
              </Select>
            </FormGroup>

            <FormGroup label="Moeda">
              <Select value={currency} onChange={(event) => setCurrency(event.target.value)}>
                {CURRENCY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </Select>
            </FormGroup>

            <div className="sm:col-span-2">
              <FormGroup label="Fuso horário">
                <Select value={timeZone} onChange={(event) => setTimeZone(event.target.value)}>
                  {!TIME_ZONE_OPTIONS.some((option) => option.value === timeZone) && <option value={timeZone}>{timeZone}</option>}
                  {TIME_ZONE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label} · {option.value}</option>)}
                </Select>
              </FormGroup>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-500 dark:border-white/[0.07] dark:bg-white/[0.025] dark:text-zinc-400">
          <p>{preferenceMode === 'auto' ? 'Preferências detectadas automaticamente neste dispositivo.' : 'Preferências definidas manualmente.'}</p>
          <p className="mt-1">A moeda altera apenas a exibição. Os valores já registrados não são convertidos.</p>
        </div>

        <div className="mt-4">
          <Button variant="outline" onClick={detectAutomatically} loading={detectingLocale}>
            Detectar automaticamente
          </Button>
        </div>
      </Card>

      {/* Editar nome */}
      <Modal open={editNameModal} onClose={() => setEditNameModal(false)} title="Editar Nome" size="sm">
        <div className="space-y-4">
          <FormGroup label="Nome" required>
            <Input value={nameForm} onChange={(e) => setNameForm(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveEditName(); }} />
          </FormGroup>
          <p className="text-xs text-muted">O e-mail não pode ser alterado por aqui.</p>
          <div className="modal-actions">
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
        <Button data-tutorial="tutorial-replay-button" variant="outline" onClick={() => { requestTutorial(); navigate('/dashboard'); }}>
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
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] mb-5">
          <Input value={catName} onChange={(e) => setCatName(e.target.value)}
            placeholder={`Nome da nova categoria de ${catType === 'expense' ? 'despesa' : 'receita'}...`}
            className="min-w-0"
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