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
  const navigate  = useNavigate();
  const register  = useAuthStore((s) => s.register);
  const clearError = useAuthStore((s) => s.clearError);
  const error     = useAuthStore((s) => s.error);
  const serverFieldErrors = useAuthStore((s) => s.fieldErrors);
  const status    = useAuthStore((s) => s.status);
  const [name, setName]         = useState('');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched]   = useState({});

  const localErrors = {
    name: validateName(name),
    email: validateEmail(email),
    password: validatePassword(password),
  };
  const fieldErrors = {
    name: serverFieldErrors.name ?? (touched.name ? localErrors.name : null),
    email: serverFieldErrors.email ?? (touched.email ? localErrors.email : null),
    password: serverFieldErrors.password ?? (touched.password ? localErrors.password : null),
  };

  function inputClass(hasError) {
    return `w-full bg-white/10 border ${hasError ? 'border-danger/60 focus:border-danger focus:ring-danger/30' : 'border-white/20 focus:border-primary focus:ring-primary/30'} text-white placeholder:text-slate-500 rounded-xl px-4 py-3 text-sm focus:ring-2 outline-none transition-all`;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setTouched({ name: true, email: true, password: true });
    if (localErrors.name || localErrors.email || localErrors.password) return;
    clearError();
    const ok = await register(name.trim(), email.trim().toLowerCase(), password);
    if (ok) navigate('/dashboard', { replace: true });
  }

  return (
    <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-3xl p-8 shadow-modal">
      <h1 className="text-2xl font-bold text-white mb-1">Criar conta</h1>
      <p className="text-slate-400 text-sm mb-7">Comece a controlar suas finanças hoje</p>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <FormGroup label={<span className="text-slate-300">Nome completo</span>} htmlFor="name" error={fieldErrors.name}>
          <input id="name" name="name" type="text" value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, name: true }))}
            placeholder="Seu nome" autoComplete="name"
            aria-invalid={!!fieldErrors.name}
            className={inputClass(!!fieldErrors.name)} />
        </FormGroup>

        <FormGroup label={<span className="text-slate-300">E-mail</span>} htmlFor="email" error={fieldErrors.email}>
          <input id="email" name="email" type="email" value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, email: true }))}
            placeholder="voce@email.com" autoComplete="email"
            aria-invalid={!!fieldErrors.email}
            className={inputClass(!!fieldErrors.email)} />
        </FormGroup>

        <FormGroup label={<span className="text-slate-300">Senha</span>} htmlFor="password" error={fieldErrors.password}
          hint="mínimo 6 caracteres">
          <input id="password" name="password" type="password" value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, password: true }))}
            placeholder="Mínimo 6 caracteres" autoComplete="new-password"
            aria-invalid={!!fieldErrors.password}
            className={inputClass(!!fieldErrors.password)} />
        </FormGroup>

        {error && (
          <div role="alert" className="bg-danger/20 border border-danger/30 text-red-300 text-sm px-4 py-3 rounded-xl">{error}</div>
        )}

        <Button type="submit" loading={status === 'loading'} className="w-full justify-center py-3 text-base">
          Criar conta
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-400">
        Já tem conta?{' '}
        <Link to="/login" className="text-primary hover:text-primary-light transition-colors font-medium">Entrar</Link>
      </p>
    </div>
  );
}
