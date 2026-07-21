import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, extractErrorMessage } from '../lib/api';
import { Button } from '../components/ui/index';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [token, setToken]       = useState(params.get('token') ?? '');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState(null);
  const [loading, setLoading]   = useState(false);
  const inputClass = "w-full bg-white/10 border border-white/20 text-white placeholder:text-slate-500 rounded-xl px-4 py-3 text-sm focus:border-primary focus:ring-2 focus:ring-primary/30 outline-none transition-all font-mono";

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
    <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-3xl p-8 shadow-modal">
      <h1 className="text-2xl font-bold text-white mb-1">Nova senha</h1>
      <p className="text-slate-400 text-sm mb-7">Defina uma senha segura para sua conta</p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <label htmlFor="token" className="sr-only">Token recebido por e-mail</label>
        <input id="token" name="token" type="text" required value={token} onChange={(e) => setToken(e.target.value)}
          placeholder="Token recebido por e-mail" autoComplete="one-time-code" className={inputClass} />
        <label htmlFor="new-password" className="sr-only">Nova senha (mínimo 6 caracteres)</label>
        <input id="new-password" name="new-password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="Nova senha (mín. 6 caracteres)" autoComplete="new-password" className="w-full bg-white/10 border border-white/20 text-white placeholder:text-slate-500 rounded-xl px-4 py-3 text-sm focus:border-primary focus:ring-2 focus:ring-primary/30 outline-none transition-all" />
        {error && <div role="alert" className="bg-danger/20 border border-danger/30 text-red-300 text-sm px-4 py-3 rounded-xl">{error}</div>}
        <Button type="submit" loading={loading} className="w-full justify-center py-3">Redefinir senha</Button>
        <p className="text-center text-sm"><Link to="/login" className="text-slate-400 hover:text-slate-300">← Voltar ao login</Link></p>
      </form>
    </div>
  );
}
