import { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { useMonthStore } from '../store/monthStore';
import { simulatorsApi, debtsApi } from '../lib/services';
import { extractErrorMessage } from '../lib/api';
import { formatCurrency } from '../lib/format';
import { Card, CardHeader, Badge, Button, EmptyState } from '../components/ui/index';
import { FormGroup, Input, Select } from '../components/ui/Modal';
import { useUIStore } from '../store/uiStore';
import { useThemeStore } from '../store/themeStore';
import { ChoiceCards, AnimatedNumber } from '../components/ui/Motion';

const SCENARIO_TYPES = [
  { value:'pay_debt', label:'Quitar dívida', icon:'⌁', description:'Simule a quitação total.', tone:'choice-card-icon-danger' },
  { value:'anticipate_installments', label:'Antecipar', icon:'⚡', description:'Reduza parcelas futuras.', tone:'choice-card-icon-warning' },
  { value:'save_monthly', label:'Guardar por mês', icon:'＋', description:'Crie uma rotina de economia.', tone:'choice-card-icon-success' },
  { value:'reduce_category', label:'Reduzir gastos', icon:'↘', description:'Teste cortes mensais.', tone:'choice-card-icon-primary' },
  { value:'increase_income', label:'Aumentar renda', icon:'↗', description:'Projete uma renda maior.', tone:'choice-card-icon-info' },
];

function CustomTooltip({ active, payload, label }) {
  const theme = useThemeStore((s) => s.theme);
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <p className="font-semibold text-slate-600 dark:text-zinc-300 mb-2">{label}</p>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-muted">{p.name}:</span>
          <span className="font-mono font-bold" style={{ color: p.color }}>{formatCurrency(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

// Antes, este bloco vivia DENTRO de WhatIfSimulatorPage como
// `function InputFields() {...}`, usado como `<InputFields />`. Isso
// parece inofensivo, mas o React identifica um componente pela referência
// da função, não pelo nome — como `WhatIfSimulatorPage` recria essa função
// a cada render (e digitar em QUALQUER campo dispara um render, via
// `setInput`), o React via ali um componente "novo" a cada tecla e
// desmontava/remontava o campo, jogando o foco fora dele no meio da
// digitação. Um componente definido no nível do módulo, como este, tem
// referência estável entre renders — o React só atualiza as props, nunca
// desmonta o input.
function ScenarioInputFields({ type, input, setInput, activeDebts }) {
  if (type === 'pay_debt') return (
    <FormGroup label="Dívida a quitar">
      <Select value={input.debtId ?? ''} onChange={(e) => setInput({ debtId: e.target.value })}>
        <option value="">Selecione...</option>
        {activeDebts.map((d) => <option key={d.id} value={d.id}>{d.description} — {formatCurrency(d.remainingBalance)}</option>)}
      </Select>
    </FormGroup>
  );
  if (type === 'anticipate_installments') return (
    <div className="grid grid-cols-2 gap-3">
      <FormGroup label="Dívida">
        <Select value={input.debtId ?? ''} onChange={(e) => setInput({...input, debtId: e.target.value})}>
          <option value="">Selecione...</option>
          {activeDebts.map((d) => <option key={d.id} value={d.id}>{d.description}</option>)}
        </Select>
      </FormGroup>
      <FormGroup label="Valor a antecipar">
        <Input type="number" min="0" step="0.01" value={input.amount ?? ''}
          onChange={(e) => setInput({...input, amount: parseFloat(e.target.value)})} />
      </FormGroup>
    </div>
  );
  // Cenários de valor mensal usam o mesmo campo numérico.
  const amountLabels = {
    save_monthly: 'Valor a guardar por mês',
    reduce_category: 'Redução mensal nos gastos',
    increase_income: 'Aumento mensal na receita',
  };
  return (
    <FormGroup label={amountLabels[type] ?? 'Valor'}>
      <Input type="number" min="0" step="0.01" value={input.amount ?? ''}
        onChange={(e) => setInput({ amount: parseFloat(e.target.value) })} placeholder="R$ 0,00" />
    </FormGroup>
  );
}

export default function WhatIfSimulatorPage() {
  const selectedMonthId = useMonthStore((s) => s.selectedMonthId);
  const [debts, setDebts]   = useState([]);
  const [saved, setSaved]   = useState([]);
  const [type, setType]     = useState('save_monthly');
  const [input, setInput]   = useState({});
  const [name, setName]     = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const toast = useUIStore((s) => s);
  const theme = useThemeStore((s) => s.theme);
  const gridStroke = theme === 'dark' ? 'rgba(255,255,255,0.06)' : '#F1F5F9';
  const axisColor  = theme === 'dark' ? '#71717A' : '#94A3B8';

  useEffect(() => {
    debtsApi.list().then((r) => setDebts(r.data.debts ?? [])).catch(() => {});
    loadSaved();
  }, []);

  async function loadSaved() {
    setLoadingSaved(true);
    try { const r = await simulatorsApi.listSaved(); setSaved(r.data.simulations ?? []); }
    catch {}
    finally { setLoadingSaved(false); }
  }

  async function runPreview() {
    if (!selectedMonthId) { toast.error('Selecione um mês.'); return; }
    setLoading(true);
    try {
      const r = await simulatorsApi.whatIfPreview({ monthId: selectedMonthId, type, input, monthsAhead: 12 });
      setResult(r.data);
    } catch (e) { toast.error(extractErrorMessage(e, 'Erro ao simular.')); }
    finally { setLoading(false); }
  }

  async function handleSave() {
    if (!name.trim()) { toast.error('Dê um nome para salvar.'); return; }
    setSaving(true);
    try {
      await simulatorsApi.whatIfSave({ monthId: selectedMonthId, type, name, input, monthsAhead: 12 });
      toast.success('Simulação salva!'); setName(''); loadSaved();
    } catch (e) { toast.error(extractErrorMessage(e, 'Erro ao salvar.')); }
    finally { setSaving(false); }
  }

  async function handleDelete(id) {
    try { await simulatorsApi.deleteSaved(id); toast.success('Removida.'); loadSaved(); }
    catch (e) { toast.error(extractErrorMessage(e, 'Erro ao excluir.')); }
  }

  const activeDebts = debts.filter((d) => d.status === 'active');

  const chartData = result?.comparison.map((m) => ({
    name: `${String(m.month).padStart(2,'0')}/${String(m.year).slice(-2)}`,
    atual: m.baselineCumulative,
    'com cenário': m.scenarioCumulative,
  })) ?? [];

  const totalGain = result?.totalGain ?? 0;

  return (
    <div className="space-y-6 animate-page-enter">
      <div>
        <h2 className="text-2xl font-bold tracking-[-0.025em] text-slate-950 dark:text-white">Simulador "E Se?"</h2>
        <p className="text-sm text-muted mt-0.5">Projete cenários alternativos sem alterar seus dados reais.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Configuração */}
        <Card>
          <CardHeader title="Configure o cenário" />
          <div className="space-y-4">
            <FormGroup label="Tipo de cenário">
              <ChoiceCards columns={2} value={type} onChange={(nextType) => { setType(nextType); setInput({}); setResult(null); }} options={SCENARIO_TYPES} />
            </FormGroup>
            <ScenarioInputFields type={type} input={input} setInput={setInput} activeDebts={activeDebts} />
            <Button onClick={runPreview} loading={loading} className="w-full justify-center py-3">
              Simular cenário
            </Button>
          </div>
        </Card>

        {/* Resultado */}
        {result ? (
          <div className="space-y-4 animate-slide-up">
            {/* Resumo */}
            <div className="grid grid-cols-2 gap-3">
              <Card className={`!p-4 ${totalGain >= 0 ? 'bg-primary-subtle border-primary/20' : 'bg-danger-subtle border-danger/20'}`}>
                <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">Ganho acumulado</p>
                <p className={`text-2xl font-bold font-mono ${totalGain >= 0 ? 'text-primary-dark' : 'text-danger-dark'}`}>
                  {totalGain >= 0 ? '+' : ''}<AnimatedNumber value={totalGain} formatter={formatCurrency} />
                </p>
              </Card>
              <Card className="!p-4">
                <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">Primeiro impacto</p>
                <p className="text-base font-bold text-slate-900 dark:text-zinc-50 mt-1">
                  {result.firstPositiveMonth
                    ? `${String(result.firstPositiveMonth.month).padStart(2,'0')}/${result.firstPositiveMonth.year}`
                    : 'Imediato'}
                </p>
              </Card>
            </div>

            {/* Gráfico */}
            <Card>
              <CardHeader title="Projeção 12 meses" subtitle="Saldo acumulado" />
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ left: -20 }}>
                    <defs>
                      <linearGradient id="atualGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#94A3B8" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#94A3B8" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="scenarioGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#16A34A" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#16A34A" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize:10, fill:axisColor }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize:10, fill:axisColor }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize:'12px' }} />
                    <Area type="monotone" dataKey="atual" stroke="#94A3B8" strokeWidth={2} fill="url(#atualGrad)" strokeDasharray="4 2" dot={false} />
                    <Area type="monotone" dataKey="com cenário" stroke="#16A34A" strokeWidth={2.5} fill="url(#scenarioGrad)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* Salvar */}
            <div className="flex gap-2">
              <Input value={name} onChange={(e) => setName(e.target.value)}
                placeholder="Nome para salvar esta simulação..." className="flex-1" />
              <Button variant="outline" onClick={handleSave} loading={saving}>Salvar</Button>
            </div>
          </div>
        ) : (
          <Card className="flex items-center justify-center !py-16">
            <div className="text-center">
              <div className="text-5xl mb-4 opacity-20">◈</div>
              <p className="font-semibold text-slate-700 dark:text-zinc-300">Configure e simule</p>
              <p className="text-sm text-muted mt-1">Escolha o cenário e clique em Simular</p>
            </div>
          </Card>
        )}
      </div>

      {/* Simulações salvas */}
      <Card>
        <CardHeader title="Simulações Salvas" subtitle="Consulte cenários anteriores" />
        {loadingSaved ? (
          <div className="space-y-2">{Array.from({length:2}).map((_,i)=><div key={i} className="h-14 shimmer-bg rounded-xl" />)}</div>
        ) : saved.length === 0 ? (
          <EmptyState icon="📁" title="Nenhuma simulação salva" description="Simule um cenário e salve para consultar depois." />
        ) : (
          <div className="space-y-2">
            {saved.map((sim) => {
              // Antes: usava só `lastResult.difference` (o impacto do
              // ÚLTIMO mês projetado, isoladamente) rotulado como "/mês" —
              // um número bem diferente do "Ganho acumulado" mostrado na
              // prévia ao vivo (que soma o impacto de TODOS os meses). As
              // duas seções pareciam mostrar a mesma coisa, mas eram
              // métricas diferentes. Agora as duas usam a mesma conta
              // (soma de `difference` de todos os meses salvos), então o
              // número aqui é diretamente comparável ao de uma prévia nova.
              const gain = (sim.results ?? []).reduce((sum, r) => sum + Number(r.difference), 0);
              return (
                <div key={sim.id} className="flex items-center justify-between p-3.5 bg-subtle dark:bg-white/[0.04] rounded-xl">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-zinc-50">{sim.name}</p>
                    <p className="text-xs text-muted mt-0.5">
                      {SCENARIO_TYPES.find((t) => t.value === sim.type)?.label ?? sim.type} · {sim.monthsAhead} meses
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-sm font-mono font-bold ${gain >= 0 ? 'text-primary-dark' : 'text-danger-dark'}`}
                      title="Ganho acumulado ao longo de todo o período simulado">
                      {gain >= 0 ? '+' : ''}{formatCurrency(gain)}
                    </span>
                    <Button variant="ghost" size="sm" className="text-danger h-8 w-8 !px-0 justify-center"
                      onClick={() => handleDelete(sim.id)}>×</Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}