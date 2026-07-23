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
  { value: 'cash-vs-installments', label: 'À vista ou parcelado' },
  { value: 'debt-payoff', label: 'Quitar dívida' },
  { value: 'emergency-reserve', label: 'Reserva' },
];

const INITIAL = {
  compound: { initialValue: '1000', monthlyContribution: '300', rate: '10', ratePeriod: 'annual', years: '5', inflationRate: '4.5' },
  financing: { assetValue: '50000', downPayment: '10000', rate: '18', ratePeriod: 'annual', months: '48', system: 'price', extraFees: '0' },
  'cash-vs-installments': { cashPrice: '950', installmentTotal: '1000', installments: '10', investmentRate: '10', investmentRatePeriod: 'annual', cashback: '0' },
  'debt-payoff': { balance: '10000', rate: '24', ratePeriod: 'annual', monthlyPayment: '600', extraMonthly: '200' },
  'emergency-reserve': { monthlyEssentialExpenses: '3000', targetMonths: '6', currentReserve: '5000', monthlyContribution: '500' },
};

function Money({ value }) {
  return <span className="font-mono font-bold">{formatCurrency(value)}</span>;
}

function Metric({ label, children }) {
  return (
    <div className="rounded-2xl border border-border bg-subtle p-4 dark:border-white/[0.07] dark:bg-white/[0.035]">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <div className="mt-1 text-lg text-slate-950 dark:text-white">{children}</div>
    </div>
  );
}

function RateFields({ value, period, onValueChange, onPeriodChange, label = 'Taxa' }) {
  return (
    <>
      <FormGroup label={`${label} (%)`}>
        <Input type="number" min="0" step="0.01" value={value} onChange={(event) => onValueChange(event.target.value)} />
      </FormGroup>
      <FormGroup label="Período da taxa">
        <Select value={period} onChange={(event) => onPeriodChange(event.target.value)}>
          <option value="monthly">Mensal</option>
          <option value="annual">Anual</option>
        </Select>
      </FormGroup>
    </>
  );
}

function ResultView({ type, result }) {
  if (!result) return null;
  if (type === 'compound') {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <Metric label="Saldo final"><Money value={result.finalBalance} /></Metric>
        <Metric label="Total investido"><Money value={result.totalInvested} /></Metric>
        <Metric label="Juros acumulados"><Money value={result.totalInterest} /></Metric>
        <Metric label="Valor real pela inflação"><Money value={result.realBalance} /></Metric>
        <Metric label="Taxa equivalente mensal">{result.monthlyEquivalentRate}%</Metric>
      </div>
    );
  }
  if (type === 'financing') {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <Metric label="Valor financiado"><Money value={result.financedAmount} /></Metric>
        <Metric label="Primeira parcela"><Money value={result.firstInstallment} /></Metric>
        <Metric label="Total de juros"><Money value={result.totalInterest} /></Metric>
        <Metric label="Total pago com entrada"><Money value={result.totalPaid} /></Metric>
        <Metric label="Taxa equivalente mensal">{result.monthlyEquivalentRate}%</Metric>
      </div>
    );
  }
  if (type === 'cash-vs-installments') {
    return (
      <>
        <div className="mb-3">
          <Badge variant={result.recommendation === 'cash' ? 'success' : 'purple'}>
            {result.recommendation === 'cash' ? 'Melhor pagar à vista' : 'Melhor parcelar'}
          </Badge>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Metric label="Custo à vista"><Money value={result.cashCost} /></Metric>
          <Metric label="Custo presente parcelado"><Money value={result.adjustedInstallmentCost} /></Metric>
          <Metric label="Vantagem estimada"><Money value={result.advantage} /></Metric>
          <Metric label="Total nominal parcelado"><Money value={result.installmentNominalCost} /></Metric>
          <Metric label="Taxa equivalente mensal">{result.monthlyEquivalentRate}%</Metric>
        </div>
      </>
    );
  }
  if (type === 'debt-payoff') {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <Metric label="Prazo atual">{result.baseline.months} meses</Metric>
        <Metric label="Prazo com valor extra">{result.accelerated.months} meses</Metric>
        <Metric label="Meses economizados">{result.monthsSaved}</Metric>
        <Metric label="Juros economizados"><Money value={result.interestSaved} /></Metric>
        <Metric label="Taxa equivalente mensal">{result.monthlyEquivalentRate}%</Metric>
      </div>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Metric label="Reserva recomendada"><Money value={result.targetReserve} /></Metric>
      <Metric label="Quanto falta"><Money value={result.missingAmount} /></Metric>
      <Metric label="Cobertura atual">{result.coverageMonths} meses</Metric>
      <Metric label="Prazo estimado">{result.monthsToReach == null ? 'Defina um aporte' : `${result.monthsToReach} meses`}</Metric>
    </div>
  );
}

export default function CalculatorsPage() {
  const toast = useUIStore((state) => state);
  const [type, setType] = useState('compound');
  const [forms, setForms] = useState(INITIAL);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const form = forms[type];
  const setField = (field, value) => setForms((current) => ({
    ...current,
    [type]: { ...current[type], [field]: value },
  }));
  const title = useMemo(() => TABS.find((tab) => tab.value === type)?.label, [type]);

  async function calculate() {
    setLoading(true);
    setResult(null);
    try {
      const response = await calculatorsApi.run(type, form);
      setResult(response.data.result);
    } catch (error) {
      toast.error(extractErrorMessage(error, 'Não foi possível calcular.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6 animate-page-enter">
      <PageHeader eyebrow="Ferramentas Pro" title="Calculadoras financeiras" description="Compare cenários antes de assumir parcelas, investir ou reorganizar uma dívida." />
      <div className="overflow-x-auto pb-1">
        <SegmentedControl value={type} onChange={(value) => { setType(value); setResult(null); }} options={TABS} />
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <h3 className="mb-5 font-bold text-slate-950 dark:text-white">{title}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {type === 'compound' && (
              <>
                <FormGroup label="Valor inicial"><Input type="number" min="0" value={form.initialValue} onChange={(event) => setField('initialValue', event.target.value)} /></FormGroup>
                <FormGroup label="Aporte mensal"><Input type="number" min="0" value={form.monthlyContribution} onChange={(event) => setField('monthlyContribution', event.target.value)} /></FormGroup>
                <RateFields value={form.rate} period={form.ratePeriod} onValueChange={(value) => setField('rate', value)} onPeriodChange={(value) => setField('ratePeriod', value)} label="Rendimento" />
                <FormGroup label="Prazo (anos)"><Input type="number" min="0.1" step="0.1" value={form.years} onChange={(event) => setField('years', event.target.value)} /></FormGroup>
                <FormGroup label="Inflação anual (%)"><Input type="number" min="0" step="0.01" value={form.inflationRate} onChange={(event) => setField('inflationRate', event.target.value)} /></FormGroup>
              </>
            )}
            {type === 'financing' && (
              <>
                <FormGroup label="Valor do bem"><Input type="number" min="0" value={form.assetValue} onChange={(event) => setField('assetValue', event.target.value)} /></FormGroup>
                <FormGroup label="Entrada"><Input type="number" min="0" value={form.downPayment} onChange={(event) => setField('downPayment', event.target.value)} /></FormGroup>
                <RateFields value={form.rate} period={form.ratePeriod} onValueChange={(value) => setField('rate', value)} onPeriodChange={(value) => setField('ratePeriod', value)} />
                <FormGroup label="Parcelas"><Input type="number" min="1" value={form.months} onChange={(event) => setField('months', event.target.value)} /></FormGroup>
                <FormGroup label="Sistema"><Select value={form.system} onChange={(event) => setField('system', event.target.value)}><option value="price">Price</option><option value="sac">SAC</option></Select></FormGroup>
                <FormGroup label="Taxas adicionais"><Input type="number" min="0" value={form.extraFees} onChange={(event) => setField('extraFees', event.target.value)} /></FormGroup>
              </>
            )}
            {type === 'cash-vs-installments' && (
              <>
                <FormGroup label="Preço à vista"><Input type="number" min="0" value={form.cashPrice} onChange={(event) => setField('cashPrice', event.target.value)} /></FormGroup>
                <FormGroup label="Total parcelado"><Input type="number" min="0" value={form.installmentTotal} onChange={(event) => setField('installmentTotal', event.target.value)} /></FormGroup>
                <FormGroup label="Quantidade de parcelas"><Input type="number" min="1" value={form.installments} onChange={(event) => setField('installments', event.target.value)} /></FormGroup>
                <RateFields value={form.investmentRate} period={form.investmentRatePeriod} onValueChange={(value) => setField('investmentRate', value)} onPeriodChange={(value) => setField('investmentRatePeriod', value)} label="Rendimento do dinheiro" />
                <FormGroup label="Cashback"><Input type="number" min="0" value={form.cashback} onChange={(event) => setField('cashback', event.target.value)} /></FormGroup>
              </>
            )}
            {type === 'debt-payoff' && (
              <>
                <FormGroup label="Saldo da dívida"><Input type="number" min="0" value={form.balance} onChange={(event) => setField('balance', event.target.value)} /></FormGroup>
                <RateFields value={form.rate} period={form.ratePeriod} onValueChange={(value) => setField('rate', value)} onPeriodChange={(value) => setField('ratePeriod', value)} />
                <FormGroup label="Parcela atual"><Input type="number" min="0" value={form.monthlyPayment} onChange={(event) => setField('monthlyPayment', event.target.value)} /></FormGroup>
                <FormGroup label="Valor extra mensal"><Input type="number" min="0" value={form.extraMonthly} onChange={(event) => setField('extraMonthly', event.target.value)} /></FormGroup>
              </>
            )}
            {type === 'emergency-reserve' && (
              <>
                <FormGroup label="Despesas essenciais/mês"><Input type="number" min="0" value={form.monthlyEssentialExpenses} onChange={(event) => setField('monthlyEssentialExpenses', event.target.value)} /></FormGroup>
                <FormGroup label="Meses de proteção"><Input type="number" min="1" value={form.targetMonths} onChange={(event) => setField('targetMonths', event.target.value)} /></FormGroup>
                <FormGroup label="Reserva atual"><Input type="number" min="0" value={form.currentReserve} onChange={(event) => setField('currentReserve', event.target.value)} /></FormGroup>
                <FormGroup label="Aporte mensal"><Input type="number" min="0" value={form.monthlyContribution} onChange={(event) => setField('monthlyContribution', event.target.value)} /></FormGroup>
              </>
            )}
          </div>
          <Button className="mt-5 w-full" loading={loading} onClick={calculate}>Calcular cenário</Button>
        </Card>
        <Card>
          <h3 className="mb-5 font-bold text-slate-950 dark:text-white">Resultado</h3>
          {result ? <ResultView type={type} result={result} /> : (
            <div className="grid min-h-[230px] place-items-center rounded-2xl border border-dashed border-border text-center text-sm text-muted dark:border-white/10">
              Preencha os dados e calcule para comparar o cenário.
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
