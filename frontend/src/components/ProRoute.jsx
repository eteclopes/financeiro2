import { Link, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { Card, Badge, Button } from './ui/index';

export function ProRoute({ children }) {
  const user = useAuthStore((state) => state.user);
  const location = useLocation();
  if (user?.isPro) return children;

  return (
    <div className="mx-auto max-w-3xl animate-page-enter py-6">
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-primary-subtle text-3xl dark:bg-primary/10">✦</div>
          <div className="min-w-0 flex-1">
            <Badge variant="purple">Recurso Pro</Badge>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-slate-950 dark:text-white">Planejamento e inteligência financeira</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              O Plano Básico continua com todo o gestor financeiro. Esta área adiciona simulações, projeções, análises e calculadoras para ajudar nas decisões.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link to="/plan" state={{ from: location.pathname }}><Button>Conhecer o Pro</Button></Link>
              <Link to="/dashboard"><Button variant="outline">Voltar ao Dashboard</Button></Link>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
