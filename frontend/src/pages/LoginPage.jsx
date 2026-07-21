import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { Button } from '../components/ui/index';
import { FormGroup } from '../components/ui/Modal';

function validateEmail(value) {
  if (!value.trim()) return 'Informe seu e-mail.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) return 'Digite um e-mail válido, ex: nome@exemplo.com.';
  return null;
}

function validatePassword(value) {
  if (!value) return 'Informe sua senha.';
  return null;
}

function FieldIcon({ children }) {
  return <span className="pointer-events-none absolute inset-y-0 left-0 grid w-11 place-items-center text-slate-400 dark:text-zinc-500">{children}</span>;
}

export default function LoginPage() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const clearError = useAuthStore((s) => s.clearError);
  const error = useAuthStore((s) => s.error);
  const serverFieldErrors = useAuthStore((s) => s.fieldErrors);
  const status = useAuthStore((s) => s.status);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState({});

  const localErrors = { email: validateEmail(email), password: validatePassword(password) };
  const fieldErrors = {
    email: serverFieldErrors.email ?? (touched.email ? localErrors.email : null),
    password: serverFieldErrors.password ?? (touched.password ? localErrors.password : null),
  };

  async function handleSubmit(e) {
    e.preventDefault();
    setTouched({ email: true, password: true });
    if (localErrors.email || localErrors.password) return;
    clearError();
    const ok = await login(email.trim().toLowerCase(), password);
    if (ok) navigate('/dashboard', { replace: true });
  }

  const inputClass = (hasError) => `input-base w-full py-3 pl-11 ${hasError ? '!border-danger focus:!ring-danger/20' : ''}`;

  return (
    <div className="auth-card rounded-[26px] p-6 sm:p-8">
      <div className="mb-7">
        <span className="mb-3 inline-flex rounded-full bg-primary-subtle px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-primary-dark dark:bg-primary/10 dark:text-primary-hover">Acesso seguro</span>
        <h1 className="text-2xl font-extrabold tracking-[-0.03em] text-slate-950 dark:text-white">Bem-vindo de volta</h1>
        <p className="mt-1.5 text-sm text-slate-500 dark:text-zinc-400">Entre para acompanhar sua vida financeira.</p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <FormGroup label="E-mail" htmlFor="email" error={fieldErrors.email}>
          <div className="relative">
            <FieldIcon>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 6h16v12H4z"/><path d="m4 7 8 6 8-6"/></svg>
            </FieldIcon>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => setTouched((t) => ({ ...t, email: true }))} placeholder="voce@email.com" autoComplete="email" aria-invalid={!!fieldErrors.email} className={inputClass(!!fieldErrors.email)} />
          </div>
        </FormGroup>

        <FormGroup label="Senha" htmlFor="password" error={fieldErrors.password}>
          <div className="relative">
            <FieldIcon>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
            </FieldIcon>
            <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} onBlur={() => setTouched((t) => ({ ...t, password: true }))} placeholder="••••••••" autoComplete="current-password" aria-invalid={!!fieldErrors.password} className={inputClass(!!fieldErrors.password)} />
          </div>
        </FormGroup>

        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-xs font-semibold text-primary-dark hover:text-primary dark:text-primary-hover">Esqueci minha senha</Link>
        </div>

        {error && <div role="alert" className="rounded-xl border border-danger/20 bg-danger-subtle px-4 py-3 text-sm text-danger-dark dark:bg-danger/10 dark:text-danger-light">{error}</div>}

        <Button type="submit" loading={status === 'loading'} className="w-full py-3 text-base">Entrar no FinanceHub</Button>
      </form>

      <div className="my-6 flex items-center gap-3"><span className="h-px flex-1 bg-slate-200 dark:bg-white/[0.07]"/><span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-zinc-600">novo por aqui?</span><span className="h-px flex-1 bg-slate-200 dark:bg-white/[0.07]"/></div>
      <Link to="/register" className="flex w-full items-center justify-center rounded-xl border border-primary px-4 py-3 text-sm font-bold text-primary-dark transition-all hover:bg-primary-subtle dark:text-primary-hover dark:hover:bg-primary/10">Criar uma conta gratuita</Link>
    </div>
  );
}
