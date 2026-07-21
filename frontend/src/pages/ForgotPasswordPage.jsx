import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, extractErrorMessage } from '../lib/api';
import { Button } from '../components/ui/index';
import { FormGroup } from '../components/ui/Modal';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

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
    <div className="auth-card rounded-[26px] p-6 sm:p-8">
      <div className="mb-7">
        <span className="mb-3 inline-flex rounded-full bg-info-subtle px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-info-dark dark:bg-info/10 dark:text-info-light">Recuperação</span>
        <h1 className="text-2xl font-extrabold tracking-[-0.03em] text-slate-950 dark:text-white">Recuperar senha</h1>
        <p className="mt-1.5 text-sm text-slate-500 dark:text-zinc-400">Enviaremos as instruções para seu e-mail.</p>
      </div>

      {result?.success ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-success/20 bg-success-subtle p-4 text-sm leading-relaxed text-success-dark dark:bg-success/10 dark:text-success-light">{result.message}</div>
          {result.devToken && (
            <div className="space-y-2 rounded-xl border border-warning/25 bg-warning-subtle p-4 text-xs dark:bg-warning/10">
              <p className="font-bold text-warning-dark dark:text-warning-light">Modo desenvolvimento</p>
              <p className="break-all font-mono text-slate-500 dark:text-zinc-400">{result.devToken}</p>
              <Link to={`/reset-password?token=${encodeURIComponent(result.devToken)}`} className="block font-bold text-primary-dark dark:text-primary-hover">Redefinir senha →</Link>
            </div>
          )}
          <Link to="/login" className="flex w-full justify-center rounded-xl border border-primary px-4 py-3 text-sm font-bold text-primary-dark hover:bg-primary-subtle dark:text-primary-hover dark:hover:bg-primary/10">Voltar ao login</Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <FormGroup label="E-mail" htmlFor="forgot-email">
            <input id="forgot-email" name="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" autoComplete="email" className="input-base w-full py-3" />
          </FormGroup>
          {result?.success === false && <div role="status" className="rounded-xl border border-danger/20 bg-danger-subtle px-4 py-3 text-sm text-danger-dark dark:bg-danger/10 dark:text-danger-light">{result.message}</div>}
          <Button type="submit" loading={loading} className="w-full py-3">Enviar instruções</Button>
          <p className="text-center text-sm"><Link to="/login" className="font-semibold text-slate-500 hover:text-primary dark:text-zinc-400">← Voltar ao login</Link></p>
        </form>
      )}
    </div>
  );
}
