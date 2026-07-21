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

export default function LoginPage() {
  const navigate  = useNavigate();
  const login     = useAuthStore((s) => s.login);
  const clearError = useAuthStore((s) => s.clearError);
  const error     = useAuthStore((s) => s.error);
  const serverFieldErrors = useAuthStore((s) => s.fieldErrors);
  const status    = useAuthStore((s) => s.status);
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched]   = useState({});

  // Erros de validação local (antes de enviar) + erros vindos do backend
  // (ex: formato inválido que passou no front mas não no back) mesclados,
  // priorizando o que o próprio backend disser sobre aquele campo.
  const localErrors = {
    email: validateEmail(email),
    password: validatePassword(password),
  };
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

  const inputClass = (hasError) =>
    `w-full bg-white/10 border ${hasError ? 'border-danger/60 focus:border-danger focus:ring-danger/30' : 'border-white/20 focus:border-primary focus:ring-primary/30'} text-white placeholder:text-slate-500 rounded-xl px-4 py-3 text-sm focus:ring-2 outline-none transition-all`;

  return (
    <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-3xl p-8 shadow-modal">
      <h1 className="text-2xl font-bold text-white mb-1">Bem-vindo de volta</h1>
      <p className="text-slate-400 text-sm mb-7">Entre na sua conta para continuar</p>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <FormGroup label={<span className="text-slate-300">E-mail</span>} htmlFor="email" error={fieldErrors.email}>
          <input id="email" type="email" value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, email: true }))}
            placeholder="voce@email.com"
            autoComplete="email"
            aria-invalid={!!fieldErrors.email}
            className={inputClass(!!fieldErrors.email)} />
        </FormGroup>

        <FormGroup label={<span className="text-slate-300">Senha</span>} htmlFor="password" error={fieldErrors.password}>
          <input id="password" type="password" value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, password: true }))}
            placeholder="••••••••"
            autoComplete="current-password"
            aria-invalid={!!fieldErrors.password}
            className={inputClass(!!fieldErrors.password)} />
        </FormGroup>

        {error && (
          <div role="alert" className="bg-danger/20 border border-danger/30 text-red-300 text-sm px-4 py-3 rounded-xl">
            {error}
          </div>
        )}

        <Button type="submit" loading={status === 'loading'} className="w-full justify-center py-3 text-base">
          Entrar
        </Button>
      </form>

      <div className="mt-6 flex items-center justify-between text-sm">
        <Link to="/register" className="text-slate-400 hover:text-primary transition-colors">
          Criar conta
        </Link>
        <Link to="/forgot-password" className="text-slate-400 hover:text-primary transition-colors">
          Esqueci a senha
        </Link>
      </div>
    </div>
  );
}
