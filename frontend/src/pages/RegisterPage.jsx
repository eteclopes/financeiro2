import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { Button } from '../components/ui/index';
import { FormGroup } from '../components/ui/Modal';

function validateName(value) {
  if (!value.trim()) return 'Informe seu nome.';
  if (value.trim().length < 2) return 'O nome deve ter pelo menos 2 caracteres.';
  return null;
}
function validateEmail(value) {
  if (!value.trim()) return 'Informe seu e-mail.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) return 'Digite um e-mail válido, ex: nome@exemplo.com.';
  return null;
}
function validatePassword(value) {
  if (!value) return 'Crie uma senha.';
  if (value.length < 6) return 'A senha deve ter pelo menos 6 caracteres.';
  return null;
}

export default function RegisterPage() {
  const navigate = useNavigate();
  const register = useAuthStore((s) => s.register);
  const clearError = useAuthStore((s) => s.clearError);
  const error = useAuthStore((s) => s.error);
  const serverFieldErrors = useAuthStore((s) => s.fieldErrors);
  const status = useAuthStore((s) => s.status);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState({});

  const localErrors = { name: validateName(name), email: validateEmail(email), password: validatePassword(password) };
  const fieldErrors = {
    name: serverFieldErrors.name ?? (touched.name ? localErrors.name : null),
    email: serverFieldErrors.email ?? (touched.email ? localErrors.email : null),
    password: serverFieldErrors.password ?? (touched.password ? localErrors.password : null),
  };

  async function handleSubmit(e) {
    e.preventDefault();
    setTouched({ name: true, email: true, password: true });
    if (localErrors.name || localErrors.email || localErrors.password) return;
    clearError();
    const ok = await register(name.trim(), email.trim().toLowerCase(), password);
    if (ok) {
      document.activeElement?.blur?.();
      navigate('/dashboard', { replace: true });
    }
  }

  const inputClass = (hasError) => `input-base w-full py-3 ${hasError ? '!border-danger' : ''}`;

  return (
    <div className="auth-card rounded-[26px] p-6 sm:p-8">
      <div className="mb-7">
        <span className="mb-3 inline-flex rounded-full bg-primary-subtle px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-primary-dark dark:bg-primary/10 dark:text-primary-hover">Comece agora</span>
        <h1 className="text-2xl font-extrabold tracking-[-0.03em] text-slate-950 dark:text-white">Crie sua conta</h1>
        <p className="mt-1.5 text-sm text-slate-500 dark:text-zinc-400">Leva menos de um minuto para começar.</p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <FormGroup label="Nome completo" htmlFor="name" error={fieldErrors.name}>
          <input id="name" name="name" type="text" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setTouched((t) => ({ ...t, name: true }))} placeholder="Seu nome" autoComplete="name" aria-invalid={!!fieldErrors.name} className={inputClass(!!fieldErrors.name)} />
        </FormGroup>
        <FormGroup label="E-mail" htmlFor="email" error={fieldErrors.email}>
          <input id="email" name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => setTouched((t) => ({ ...t, email: true }))} placeholder="voce@email.com" autoComplete="email" aria-invalid={!!fieldErrors.email} className={inputClass(!!fieldErrors.email)} />
        </FormGroup>
        <FormGroup label="Senha" htmlFor="password" error={fieldErrors.password} hint="mínimo 6 caracteres">
          <input id="password" name="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} onBlur={() => setTouched((t) => ({ ...t, password: true }))} placeholder="Crie uma senha segura" autoComplete="new-password" aria-invalid={!!fieldErrors.password} className={inputClass(!!fieldErrors.password)} />
        </FormGroup>

        {error && <div role="alert" className="rounded-xl border border-danger/20 bg-danger-subtle px-4 py-3 text-sm text-danger-dark dark:bg-danger/10 dark:text-danger-light">{error}</div>}

        <Button type="submit" loading={status === 'loading'} className="w-full py-3 text-base">Criar minha conta</Button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-500 dark:text-zinc-400">Já possui uma conta? <Link to="/login" className="font-bold text-primary-dark hover:text-primary dark:text-primary-hover">Entrar</Link></p>
    </div>
  );
}
