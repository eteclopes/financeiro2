import { useState, useEffect } from 'react';
import { useMonthStore } from '../store/monthStore';
import { simulatorsApi, cardsApi } from '../lib/services';
import { extractErrorMessage } from '../lib/api';
import { formatCurrency } from '../lib/format';
import { Card, CardHeader, Badge, Button, ProgressBar } from '../components/ui/index';
import { FormGroup, Input, Select } from '../components/ui/Modal';
import { useUIStore } from '../store/uiStore';
import { ChoiceCards, AnimatedNumber } from '../components/ui/Motion';

const BAND_STYLES = {
  saudavel: { bg:'bg-success-subtle border-success/20 dark:bg-success/10', text:'text-success-dark dark:text-success-light', bar:'success', label:'Saudável ✓' },
  atencao:  { bg:'bg-warning-subtle border-warning/20', text:'text-warning-dark', bar:'warning', label:'Atenção ⚠' },
  risco:    { bg:'bg-warning-subtle border-warning/20', text:'text-warning-dark', bar:'warning', label:'Risco ⚠' },
  critico:  { bg:'bg-danger-subtle border-danger/20',   text:'text-danger-dark',  bar:'danger',  label:'Crítico ✕' },
};

export default function PurchaseSimulatorPage() {
  const selectedMonthId = useMonthStore((s) => s.selectedMonthId);
  const [cards, setCards]     = useState([]);
  const [form, setForm]       = useState({ description:'', value:'', installments:'1', cardId:'' });
  const [result, setResult]   = useState(null);
  const [loading, setLoading] = useState(false);
  const toast = useUIStore((s) => s);

  useEffect(() => {
    cardsApi.list().then((r) => setCards(r.data.cards ?? [])).catch(() => {});
  }, []);

  async function simulate() {
    if (!form.description || !form.value || !selectedMonthId) {
      toast.error('Preencha a descrição e o valor.'); return;
    }
    setLoading(true);
    try {
      const payload = {
        monthId: selectedMonthId,
        description: form.description,
        value: parseFloat(form.value),
        installments: parseInt(form.installments),
        ...(form.cardId ? { cardId: form.cardId } : {}),
      };
      const r = await simulatorsApi.purchase(payload);
      setResult(r.data);
    } catch (e) { toast.error(extractErrorMessage(e, 'Erro ao simular.')); }
    finally { setLoading(false); }
  }

  const band = result ? (BAND_STYLES[result.commitmentBand] ?? BAND_STYLES.atencao) : null;

  return (
    <div className="space-y-6 animate-page-enter max-w-3xl">
      <div>
        <h2 className="text-2xl font-bold tracking-[-0.025em] text-slate-950 dark:text-white">Simulador de Compras</h2>
        <p className="text-sm text-muted mt-0.5">Analise o impacto antes de comprar. Nenhum dado é salvo.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Painel de entrada */}
        <Card>
          <CardHeader title="Dados da Compra" />
          <div className="space-y-4">
            <FormGroup label="Produto / Descrição" required>
              <Input value={form.description} onChange={(e) => setForm({...form, description:e.target.value})}
                placeholder="Ex: Notebook, Geladeira, Tênis..." autoFocus />
            </FormGroup>
            <FormGroup label="Valor total" required>
              <Input type="number" min="0" step="0.01" value={form.value}
                onChange={(e) => setForm({...form, value:e.target.value})} placeholder="R$ 0,00" />
            </FormGroup>
            <FormGroup label="Como pretende pagar?">
              <ChoiceCards columns={2} value={parseInt(form.installments) === 1 ? 'cash' : 'installments'} onChange={(mode) => setForm({ ...form, installments: mode === 'cash' ? '1' : (parseInt(form.installments) > 1 ? form.installments : '6') })} options={[
                { value:'cash', label:'À vista', description:'Impacto total imediato.', icon:'✓', tone:'choice-card-icon-success' },
                { value:'installments', label:'Parcelado', description:'Distribui o impacto mensal.', icon:'▤', tone:'choice-card-icon-primary' },
              ]} />
            </FormGroup>
            {parseInt(form.installments) > 1 && (
              <FormGroup label="Quantidade de parcelas">
                <Select value={form.installments} onChange={(e) => setForm({...form, installments:e.target.value})}>
                  {[2,3,4,5,6,7,8,9,10,11,12,18,24].map((n) => (
                    <option key={n} value={n}>{n}x {form.value ? `de ${formatCurrency(parseFloat(form.value||0)/n)}` : ''}</option>
                  ))}
                </Select>
              </FormGroup>
            )}
            {form.value && parseInt(form.installments) > 1 && (
              <div className="bg-info-subtle border border-info/20 rounded-xl p-3 text-sm">
                <span className="text-info-dark">{form.installments}x de </span>
                <span className="font-mono font-bold text-info-dark">{formatCurrency(parseFloat(form.value)/parseInt(form.installments))}</span>
              </div>
            )}
            <FormGroup label="Cartão utilizado" hint="opcional">
              <Select value={form.cardId} onChange={(e) => setForm({...form, cardId:e.target.value})}>
                <option value="">Sem cartão / dinheiro</option>
                {cards.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} — disponível: {formatCurrency(c.availableLimit)}</option>
                ))}
              </Select>
            </FormGroup>
            <Button onClick={simulate} loading={loading} className="w-full justify-center py-3">
              Analisar Compra
            </Button>
          </div>
        </Card>

        {/* Resultado */}
        {result ? (
          <div className="space-y-4 animate-slide-up">
            {/* Veredicto */}
            <div className={`rounded-2xl border p-5 ${result.recommended ? 'bg-success-subtle border-success/20 dark:bg-success/10' : 'bg-danger-subtle border-danger/20'}`}>
              <div className="flex items-start gap-4">
                <div className={`h-14 w-14 rounded-2xl flex items-center justify-center text-3xl font-bold shrink-0 ${result.recommended ? 'bg-success text-white' : 'bg-danger text-white'}`}>
                  {result.recommended ? '✓' : '✕'}
                </div>
                <div>
                  <p className={`text-lg font-bold ${result.recommended ? 'text-success-dark dark:text-success-light' : 'text-danger-dark'}`}>
                    {result.recommended ? 'Compra Recomendada' : 'Não Recomendada'}
                  </p>
                  <p className="text-sm text-slate-600 dark:text-zinc-400 mt-0.5 leading-relaxed">{result.explanation}</p>
                </div>
              </div>
            </div>

            {/* Impacto */}
            <div className="grid grid-cols-2 gap-3">
              <Card className="!p-4">
                <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">Impacto Mensal</p>
                <p className="text-2xl font-bold font-mono text-slate-900 dark:text-zinc-50"><AnimatedNumber value={result.monthlyImpact} formatter={formatCurrency} /></p>
              </Card>
              <Card className="!p-4">
                <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">Impacto Anual</p>
                <p className="text-2xl font-bold font-mono text-slate-900 dark:text-zinc-50"><AnimatedNumber value={result.annualImpact} formatter={formatCurrency} /></p>
              </Card>
            </div>

            {/* Comprometimento */}
            <Card>
              <CardHeader title="Comprometimento da Renda" />
              <div className={`flex items-center gap-3 p-4 rounded-2xl border mb-3 ${band.bg}`}>
                <p className={`text-4xl font-bold font-mono ${band.text}`}>{result.monthlyCommitmentRatio}%</p>
                <div>
                  <Badge variant={result.commitmentBand === 'saudavel' ? 'success' : result.commitmentBand === 'critico' ? 'danger' : 'warning'}>
                    {band.label}
                  </Badge>
                  <p className={`text-xs mt-1 ${band.text}`}>da renda comprometida</p>
                </div>
              </div>
              <ProgressBar value={result.monthlyCommitmentRatio} max={100} height="h-3" color={band.bar} />
            </Card>

            {/* Cartão */}
            {result.cardCheck && (
              <Card className="!p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-slate-900 dark:text-zinc-50 text-sm">{result.cardCheck.cardName}</p>
                    <p className="text-xs text-muted mt-0.5">Disponível: <span className="font-mono">{formatCurrency(result.cardCheck.availableLimit)}</span></p>
                  </div>
                  <Badge variant={result.cardCheck.sufficient ? 'success' : 'danger'}>
                    {result.cardCheck.sufficient ? 'Limite OK' : 'Limite insuficiente'}
                  </Badge>
                </div>
              </Card>
            )}

            {/* Sugestões */}
            {(result.bestInstallments || result.waitUntil) && (
              <div className="bg-info-subtle border border-info/20 rounded-2xl p-4 space-y-2">
                <p className="text-xs font-bold text-info-dark uppercase tracking-wider">Sugestões do sistema</p>
                {result.bestInstallments && result.bestInstallments !== result.installments && (
                  <p className="text-sm text-info-dark">
                    💡 Melhor parcelamento: <strong>{result.bestInstallments}x de {formatCurrency(parseFloat(form.value)/result.bestInstallments)}</strong>
                  </p>
                )}
                {result.waitUntil && (
                  <p className="text-sm text-info-dark">
                    📅 Aguardar até <strong>{String(result.waitUntil.month).padStart(2,'0')}/{result.waitUntil.year}</strong>
                    {result.waitUntil.installments > 1
                      ? <> e parcelar em <strong>{result.waitUntil.installments}x</strong> para melhor margem financeira.</>
                      : ' para melhor margem financeira, pagando à vista.'}
                  </p>
                )}
              </div>
            )}
          </div>
        ) : (
          <Card className="flex items-center justify-center !py-16">
            <div className="text-center">
              <div className="text-5xl mb-4 opacity-20">⊕</div>
              <p className="font-semibold text-slate-700 dark:text-zinc-300">Configure e simule</p>
              <p className="text-sm text-muted mt-1">Preencha os dados ao lado e clique em Analisar</p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}