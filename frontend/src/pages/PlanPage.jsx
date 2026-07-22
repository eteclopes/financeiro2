import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { billingApi } from '../lib/services';
import { extractErrorMessage } from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { useUIStore } from '../store/uiStore';
import { Card, Badge, Button, PageHeader, Spinner } from '../components/ui/index';

const BASIC = [
  'Receitas, recorrências e despesas completas',
  'Despesas fixas, dívidas e orçamento',
  'Até 2 cartões ativos com faturas e parcelas',
  'Reserva, metas e histórico financeiro',
  'Dashboard, alertas e relatório mensal',
];

const PRO = [
  'Cartões ativos sem limite e visão consolidada',
  'Simulador de compras e cenários “E Se?”',
  'Projeções, tendências e recomendações avançadas',
  'Relatórios analíticos completos',
  'Central de planejamento de cartões, dívidas e metas',
  'Dashboard Pro personalizável e sincronizado',
  'Calculadoras de juros, financiamento, taxas e dívidas',
  'Novos recursos Pro liberados nesta versão vitalícia',
];

const PURCHASE_STATUS = {
  pending: { label: 'Pagamento pendente', tone: 'warning' },
  paid: { label: 'Pagamento confirmado', tone: 'success' },
  failed: { label: 'Pagamento não concluído', tone: 'danger' },
  expired: { label: 'Checkout expirado', tone: 'default' },
  refunded: { label: 'Pagamento reembolsado', tone: 'default' },
};

export default function PlanPage() {
  const user = useAuthStore((state) => state.user);
  const reloadUser = useAuthStore((state) => state.reloadUser);
  const toast = useUIStore((state) => state);
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  const loadStatus = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const response = await billingApi.status();
      setStatus(response.data);
      await reloadUser();
      return response.data;
    } catch (error) {
      if (!quiet) toast.error(extractErrorMessage(error, 'Não foi possível carregar o plano.'));
      return null;
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [reloadUser]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  useEffect(() => {
    if (searchParams.get('checkout') !== 'success') return undefined;
    let cancelled = false;
    let attempts = 0;
    let timerId;
    const check = async () => {
      attempts += 1;
      const data = await loadStatus({ quiet: true });
      if (cancelled) return;
      if (data?.isPro) {
        toast.success('Pagamento confirmado. Plano Pro liberado!');
        return;
      }
      if (attempts < 6) timerId = window.setTimeout(check, 1800);
      else toast.info('Pagamento recebido. A confirmação pode levar alguns instantes; use “Atualizar acesso”.');
    };
    check();
    return () => {
      cancelled = true;
      if (timerId) window.clearTimeout(timerId);
    };
  }, [searchParams, loadStatus]);

  async function startCheckout() {
    setCheckoutLoading(true);
    try {
      const response = await billingApi.createCheckout();
      window.location.assign(response.data.checkoutUrl);
    } catch (error) {
      toast.error(extractErrorMessage(error, 'Não foi possível abrir o pagamento.'));
      setCheckoutLoading(false);
    }
  }

  if (loading) return <div className="grid min-h-[40vh] place-items-center"><Spinner size="lg" /></div>;
  const isPro = status?.isPro || user?.isPro;

  return (
    <div className="space-y-6 animate-page-enter">
      <PageHeader eyebrow="Planos" title="Básico completo. Pro para ir além." description="O plano gratuito administra sua vida financeira; o Pro adiciona ferramentas para prever cenários e tomar decisões melhores." />

      {searchParams.get('checkout') === 'cancelled' && (
        <div className="rounded-2xl border border-warning/25 bg-warning-subtle p-4 text-sm text-warning-dark dark:bg-warning/10 dark:text-warning-light">
          Pagamento cancelado. Nenhuma alteração foi feita na sua conta.
        </div>
      )}

      {isPro && (
        <Card className="border-primary/30 bg-primary-subtle/50 dark:bg-primary/[0.06]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div><Badge variant="success">PRO ATIVO</Badge><h3 className="mt-2 text-xl font-bold text-slate-950 dark:text-white">Acesso Pro vitalício liberado</h3><p className="mt-1 text-sm text-muted">Sua conta já possui todos os recursos avançados desta versão.</p></div>
            <Button variant="outline" onClick={() => loadStatus()}>Atualizar acesso</Button>
          </div>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between"><div><Badge>Básico</Badge><h3 className="mt-3 text-xl font-bold text-slate-950 dark:text-white">Gestor financeiro completo</h3></div><span className="text-lg font-bold text-success">Grátis</span></div>
          <ul className="mt-5 space-y-3">{BASIC.map((item) => <li key={item} className="flex gap-2 text-sm text-slate-700 dark:text-zinc-300"><span className="text-success">✓</span><span>{item}</span></li>)}</ul>
        </Card>

        <Card className="border-primary/30">
          <div className="flex items-start justify-between gap-3"><div><Badge variant="purple">Pro vitalício</Badge><h3 className="mt-3 text-xl font-bold text-slate-950 dark:text-white">Decisões mais inteligentes</h3><p className="mt-1 text-sm text-muted">{status?.priceLabel || 'Oferta vitalícia'}</p></div><span className="text-2xl">✦</span></div>
          <ul className="mt-5 space-y-3">{PRO.map((item) => <li key={item} className="flex gap-2 text-sm text-slate-700 dark:text-zinc-300"><span className="text-primary">✓</span><span>{item}</span></li>)}</ul>
          <div className="mt-6">
            {isPro ? <Button className="w-full" disabled>Plano já ativo</Button> : status?.billingConfigured ? <Button className="w-full" loading={checkoutLoading} onClick={startCheckout}>Comprar acesso Pro</Button> : <div className="rounded-xl border border-info/20 bg-info-subtle p-3 text-sm text-info-dark dark:bg-info/10 dark:text-info-light">Integração pronta. Cadastre as chaves e o Price ID do Stripe no backend para habilitar o botão de pagamento.</div>}
          </div>
        </Card>
      </div>

      {status?.latestPurchase && (
        <Card>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="text-sm font-bold text-slate-950 dark:text-white">Última tentativa de compra</p><p className="mt-1 text-xs text-muted">O acesso só é alterado após confirmação segura do pagamento.</p></div>
            <Badge variant={PURCHASE_STATUS[status.latestPurchase.status]?.tone || 'default'}>{PURCHASE_STATUS[status.latestPurchase.status]?.label || status.latestPurchase.status}</Badge>
          </div>
        </Card>
      )}

      {!isPro && <div className="text-center"><Button variant="outline" onClick={() => loadStatus()}>Atualizar acesso</Button></div>}
    </div>
  );
}
