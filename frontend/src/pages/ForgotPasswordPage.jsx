import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, extractErrorMessage } from '../lib/api';
import { Button } from '../components/ui/index';

export default function ForgotPasswordPage() {
  const [email, setEmail]   = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const inputClass = "w-full bg-white/10 border border-white/20 text-white placeholder:text-slate-500 rounded-xl px-4 py-3 text-sm focus:border-primary focus:ring-2 focus:ring-primary/30 outline-none transition-all";

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post('/auth/forgot-password', { email: email.trim().toLowerCase() });
      setResult({ success: true, message: data.message, devToken: data.devToken ?? null });
    } catch (err) {
      setResult({ success: false, message: extractErrorMessage(err) });
    } finally { setLoading(false); }
  }

  return (
    <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-3xl p-8 shadow-modal">
      <h1 className="text-2xl font-bold text-white mb-1">Recuperar senha</h1>
      <p className="text-slate-400 text-sm mb-7">Enviaremos instruções para seu e-mail</p>

      {result?.success ? (
        <div className="space-y-4">
          <p className="text-slate-300 text-sm">{result.message}</p>
          {result.devToken && (
            <div className="bg-warning/10 border border-warning/30 rounded-xl p-4 text-xs space-y-2">
              <p className="text-warning font-semibold">Modo desenvolvimento</p>
              <p className="text-slate-400 break-all font-mono">{result.devToken}</p>
              <Link to={`/reset-password?token=${encodeURIComponent(result.devToken)}`}
                className="block text-primary hover:text-primary-light font-medium">
                Redefinir senha →
              </Link>
            </div>
          )}
          <Link to="/login" className="block text-center text-primary hover:text-primary-light text-sm mt-4">
            ← Voltar ao login
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <label htmlFor="email" className="sr-only">E-mail</label>
          <input id="email" name="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@email.com" autoComplete="email" className={inputClass} />
          {result?.success === false && (
            <div role="status" className="bg-danger/20 border border-danger/30 text-red-300 text-sm px-4 py-3 rounded-xl">{result.message}</div>
          )}
          <Button type="submit" loading={loading} className="w-full justify-center py-3">Enviar instruções</Button>
          <p className="text-center text-sm">
            <Link to="/login" className="text-slate-400 hover:text-slate-300">← Voltar ao login</Link>
          </p>
        </form>
      )}
    </div>
  );
}
