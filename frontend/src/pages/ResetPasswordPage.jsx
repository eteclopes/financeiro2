import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, extractErrorMessage } from '../lib/api';
import { Button } from '../components/ui/index';
import { FormGroup } from '../components/ui/Modal';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [token, setToken] = useState(params.get('token') ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true); setError(null);
    try {
      await api.post('/auth/reset-password', { token, password });
      navigate('/login');
    } catch (err) { setError(extractErrorMessage(err)); }
    finally { setLoading(false); }
  }

  return (
    <div className="auth-card rounded-[26px] p-6 sm:p-8">
      <div className="mb-7">
        <span className="mb-3 inline-flex rounded-full bg-primary-subtle px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-primary-dark dark:bg-primary/10 dark:text-primary-hover">Nova credencial</span>
        <h1 className="text-2xl font-extrabold tracking-[-0.03em] text-slate-950 dark:text-white">Defina uma nova senha</h1>
        <p className="mt-1.5 text-sm text-slate-500 dark:text-zinc-400">Escolha uma senha segura para sua conta.</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormGroup label="Token recebido" htmlFor="token">
          <input id="token" name="token" type="text" required value={token} onChange={(e) => setToken(e.target.value)} placeholder="Cole o token recebido por e-mail" autoComplete="one-time-code" className="input-base w-full py-3 font-mono" />
        </FormGroup>
        <FormGroup label="Nova senha" htmlFor="new-password" hint="mínimo 6 caracteres">
          <input id="new-password" name="new-password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Crie uma nova senha" autoComplete="new-password" className="input-base w-full py-3" />
        </FormGroup>
        {error && <div role="alert" className="rounded-xl border border-danger/20 bg-danger-subtle px-4 py-3 text-sm text-danger-dark dark:bg-danger/10 dark:text-danger-light">{error}</div>}
        <Button type="submit" loading={loading} className="w-full py-3">Salvar nova senha</Button>
        <p className="text-center text-sm"><Link to="/login" className="font-semibold text-slate-500 hover:text-primary dark:text-zinc-400">← Voltar ao login</Link></p>
      </form>
    </div>
  );
}
