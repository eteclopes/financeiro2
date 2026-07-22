import { useMemo, useState } from 'react';
import { calculatorsApi } from '../lib/services';
import { extractErrorMessage } from '../lib/api';
import { formatCurrency } from '../lib/format';
import { useUIStore } from '../store/uiStore';
import { Card, Badge, Button, PageHeader } from '../components/ui/index';
import { FormGroup, Input, Select } from '../components/ui/Modal';
import { SegmentedControl } from '../components/ui/Motion';

const TABS = [
  { value: 'compound', label: 'Juros compostos' },
  { value: 'financing', label: 'Financiamento' },
  { value: 'rate', label: 'Taxas' },
  { value: 'cash-vs-installments', label: 'À vista ou parcelado' },
  { value: 'debt-payoff', label: 'Quitar dívida' },
  { value: 'emergency-reserve', label: 'Reserva' },
];

const INITIAL = {
  compound: { initialValue: '1000', monthlyContribution: '300', annualRate: '10', years: '5', inflationRate: '4.5' },
  financing: { assetValue: '50000', downPayment: '10000', annualRate: '18', months: '48', system: 'price', extraFees: '0' },
  rate: { rate: '1', source: 'monthly' },
  'cash-vs-installments': { cashPrice: '950', installmentTotal: '1000', installments: '10', annualInvestmentRate: '10', cashback: '0' },
  'debt-payoff': { balance: '10000', annualRate: '24', monthlyPayment: '600', extraMonthly: '200' },
  'emergency-reserve': { monthlyEssentialExpenses: '3000', targetMonths: '6', currentReserve: '5000', monthlyContribution: '500' },
};

function Money({ value }) { return <span className="font-mono font-bold">{formatCurrency(value)}</span>; }
function Metric({ label, children }) { return <div className="rounded-2xl border border-border bg-subtle p-4 dark:border-white/[0.07] dark:bg-white/[0.035]"><p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p><div className="mt-1 text-lg text-slate-950 dark:text-white">{children}</div></div>; }

function ResultView({ type, result }) {
  if (!result) return null;
  if (type === 'compound') return <div className="grid gap-3 sm:grid-cols-2"><Metric label="Saldo final"><Money value={result.finalBalance} /></Metric><Metric label="Total investido"><Money value={result.totalInvested} /></Metric><Metric label="Juros acumulados"><Money value={result.totalInterest} /></Metric><Metric label="Valor real pela inflação"><Money value={result.realBalance} /></Metric></div>;
  if (type === 'financing') return <div className="grid gap-3 sm:grid-cols-2"><Metric label="Valor financiado"><Money value={result.financedAmount} /></Metric><Metric label="Primeira parcela"><Money value={result.firstInstallment} /></Metric><Metric label="Total de juros"><Money value={result.totalInterest} /></Metric><Metric label="Total pago com entrada"><Money value={result.totalPaid} /></Metric></div>;
  if (type === 'rate') return <div className="grid gap-3 sm:grid-cols-2"><Metric label="Taxa mensal">{result.monthlyRate}%</Metric><Metric label="Taxa anual">{result.annualRate}%</Metric></div>;
  if (type === 'cash-vs-installments') return <><div className="mb-3"><Badge variant={result.recommendation === 'cash' ? 'success' : 'purple'}>{result.recommendation === 'cash' ? 'Melhor pagar à vista' : 'Melhor parcelar'}</Badge></div><div className="grid gap-3 sm:grid-cols-2"><Metric label="Custo à vista"><Money value={result.cashCost} /></Metric><Metric label="Custo presente parcelado"><Money value={result.adjustedInstallmentCost} /></Metric><Metric label="Vantagem estimada"><Money value={result.advantage} /></Metric><Metric label="Total nominal parcelado"><Money value={result.installmentNominalCost} /></Metric></div></>;
  if (type === 'debt-payoff') return <div className="grid gap-3 sm:grid-cols-2"><Metric label="Prazo atual">{result.baseline.months} meses</Metric><Metric label="Prazo com valor extra">{result.accelerated.months} meses</Metric><Metric label="Meses economizados">{result.monthsSaved}</Metric><Metric label="Juros economizados"><Money value={result.interestSaved} /></Metric></div>;
  return <div className="grid gap-3 sm:grid-cols-2"><Metric label="Reserva recomendada"><Money value={result.targetReserve} /></Metric><Metric label="Quanto falta"><Money value={result.missingAmount} /></Metric><Metric label="Cobertura atual">{result.coverageMonths} meses</Metric><Metric label="Prazo estimado">{result.monthsToReach == null ? 'Defina um aporte' : `${result.monthsToReach} meses`}</Metric></div>;
}

export default function CalculatorsPage() {
  const toast = useUIStore((state) => state);
  const [type, setType] = useState('compound');
  const [forms, setForms] = useState(INITIAL);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const form = forms[type];
  const setField = (field, value) => setForms((current) => ({ ...current, [type]: { ...current[type], [field]: value } }));
  const title = useMemo(() => TABS.find((tab) => tab.value === type)?.label, [type]);

  async function calculate() {
    setLoading(true); setResult(null);
    try { const response = await calculatorsApi.run(type, form); setResult(response.data.result); }
    catch (error) { toast.error(extractErrorMessage(error, 'Não foi possível calcular.')); }
    finally { setLoading(false); }
  }

  return (
    <div className="space-y-6 animate-page-enter">
      <PageHeader eyebrow="Ferramentas Pro" title="Calculadoras financeiras" description="Compare cenários antes de assumir parcelas, investir ou reorganizar uma dívida." />
      <div className="overflow-x-auto pb-1"><SegmentedControl value={type} onChange={(value) => { setType(value); setResult(null); }} options={TABS} /></div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card><h3 className="mb-5 font-bold text-slate-950 dark:text-white">{title}</h3><div className="grid gap-4 sm:grid-cols-2">
          {type === 'compound' && <><FormGroup label="Valor inicial"><Input type="number" min="0" value={form.initialValue} onChange={(e)=>setField('initialValue',e.target.value)} /></FormGroup><FormGroup label="Aporte mensal"><Input type="number" min="0" value={form.monthlyContribution} onChange={(e)=>setField('monthlyContribution',e.target.value)} /></FormGroup><FormGroup label="Taxa anual (%)"><Input type="number" min="0" step="0.01" value={form.annualRate} onChange={(e)=>setField('annualRate',e.target.value)} /></FormGroup><FormGroup label="Prazo (anos)"><Input type="number" min="0.1" step="0.1" value={form.years} onChange={(e)=>setField('years',e.target.value)} /></FormGroup><FormGroup label="Inflação anual (%)"><Input type="number" min="0" step="0.01" value={form.inflationRate} onChange={(e)=>setField('inflationRate',e.target.value)} /></FormGroup></>}
          {type === 'financing' && <><FormGroup label="Valor do bem"><Input type="number" value={form.assetValue} onChange={(e)=>setField('assetValue',e.target.value)} /></FormGroup><FormGroup label="Entrada"><Input type="number" value={form.downPayment} onChange={(e)=>setField('downPayment',e.target.value)} /></FormGroup><FormGroup label="Taxa anual (%)"><Input type="number" step="0.01" value={form.annualRate} onChange={(e)=>setField('annualRate',e.target.value)} /></FormGroup><FormGroup label="Parcelas"><Input type="number" value={form.months} onChange={(e)=>setField('months',e.target.value)} /></FormGroup><FormGroup label="Sistema"><Select value={form.system} onChange={(e)=>setField('system',e.target.value)}><option value="price">Price</option><option value="sac">SAC</option></Select></FormGroup><FormGroup label="Taxas adicionais"><Input type="number" value={form.extraFees} onChange={(e)=>setField('extraFees',e.target.value)} /></FormGroup></>}
          {type === 'rate' && <><FormGroup label="Taxa (%)"><Input type="number" step="0.0001" value={form.rate} onChange={(e)=>setField('rate',e.target.value)} /></FormGroup><FormGroup label="Origem"><Select value={form.source} onChange={(e)=>setField('source',e.target.value)}><option value="monthly">Mensal</option><option value="annual">Anual</option></Select></FormGroup></>}
          {type === 'cash-vs-installments' && <><FormGroup label="Preço à vista"><Input type="number" value={form.cashPrice} onChange={(e)=>setField('cashPrice',e.target.value)} /></FormGroup><FormGroup label="Total parcelado"><Input type="number" value={form.installmentTotal} onChange={(e)=>setField('installmentTotal',e.target.value)} /></FormGroup><FormGroup label="Quantidade de parcelas"><Input type="number" value={form.installments} onChange={(e)=>setField('installments',e.target.value)} /></FormGroup><FormGroup label="Rendimento anual (%)"><Input type="number" step="0.01" value={form.annualInvestmentRate} onChange={(e)=>setField('annualInvestmentRate',e.target.value)} /></FormGroup><FormGroup label="Cashback"><Input type="number" value={form.cashback} onChange={(e)=>setField('cashback',e.target.value)} /></FormGroup></>}
          {type === 'debt-payoff' && <><FormGroup label="Saldo da dívida"><Input type="number" value={form.balance} onChange={(e)=>setField('balance',e.target.value)} /></FormGroup><FormGroup label="Taxa anual (%)"><Input type="number" step="0.01" value={form.annualRate} onChange={(e)=>setField('annualRate',e.target.value)} /></FormGroup><FormGroup label="Parcela atual"><Input type="number" value={form.monthlyPayment} onChange={(e)=>setField('monthlyPayment',e.target.value)} /></FormGroup><FormGroup label="Valor extra mensal"><Input type="number" value={form.extraMonthly} onChange={(e)=>setField('extraMonthly',e.target.value)} /></FormGroup></>}
          {type === 'emergency-reserve' && <><FormGroup label="Despesas essenciais/mês"><Input type="number" value={form.monthlyEssentialExpenses} onChange={(e)=>setField('monthlyEssentialExpenses',e.target.value)} /></FormGroup><FormGroup label="Meses de proteção"><Input type="number" value={form.targetMonths} onChange={(e)=>setField('targetMonths',e.target.value)} /></FormGroup><FormGroup label="Reserva atual"><Input type="number" value={form.currentReserve} onChange={(e)=>setField('currentReserve',e.target.value)} /></FormGroup><FormGroup label="Aporte mensal"><Input type="number" value={form.monthlyContribution} onChange={(e)=>setField('monthlyContribution',e.target.value)} /></FormGroup></>}
        </div><Button className="mt-5 w-full" loading={loading} onClick={calculate}>Calcular cenário</Button></Card>
        <Card><h3 className="mb-5 font-bold text-slate-950 dark:text-white">Resultado</h3>{result ? <ResultView type={type} result={result} /> : <div className="grid min-h-[230px] place-items-center rounded-2xl border border-dashed border-border text-center text-sm text-muted dark:border-white/10">Preencha os dados e calcule para comparar o cenário.</div>}</Card>
      </div>
    </div>
  );
}
