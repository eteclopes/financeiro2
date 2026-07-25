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
  { value: 'installment-cost', label: 'Custo do parcelamento' },
  { value: 'payoff-vs-invest', label: 'Antecipar ou investir' },
  { value: 'goal-plan', label: 'Meta por prazo' },
];

const INITIAL = {
  compound: { initialValue: '1000', monthlyContribution: '300', rate: '10', ratePeriod: 'annual', years: '5', inflationRate: '4.5' },
  financing: { assetValue: '50000', downPayment: '10000', rate: '18', ratePeriod: 'annual', months: '48', system: 'price', extraFees: '0' },
  'installment-cost': { cashPrice: '1000', installmentValue: '100', installments: '12', investmentRate: '11', investmentRatePeriod: 'annual' },
  'payoff-vs-invest': { debtBalance: '5000', debtRate: '3', debtRatePeriod: 'monthly', investmentRate: '11', investmentRatePeriod: 'annual', extraAmount: '1000', horizonMonths: '12' },
  'goal-plan': { targetAmount: '20000', currentAmount: '2000', months: '18', investmentRate: '11', investmentRatePeriod: 'annual' },
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
  if (type === 'installment-cost') {
    return (
      <>
        <div className="mb-3">
          <Badge variant={result.isInterestFree ? 'success' : 'danger'}>
            {result.isInterestFree ? 'Sem juros de verdade' : `Juros embutido: ${result.monthlyInterestRate}% ao mês`}
          </Badge>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Metric label="Preço à vista"><Money value={result.cashPrice} /></Metric>
          <Metric label="Total parcelado"><Money value={result.nominalTotal} /></Metric>
          <Metric label="Juros embutido (R$)"><Money value={result.embeddedInterest} /></Metric>
          <Metric label="Taxa embutida mensal">{result.monthlyInterestRate}%</Metric>
          <Metric label="Taxa embutida anual">{result.annualInterestRate}%</Metric>
          <Metric label="Recomendação">{result.recommendation === 'cash' ? 'Pagar à vista' : 'Parcelar e investir'}</Metric>
        </div>
        <p className="mt-3 text-xs text-muted">
          Se você tem o dinheiro à vista, parcelar só vale a pena quando ele rende mais que a taxa embutida acima.
        </p>
      </>
    );
  }
  if (type === 'payoff-vs-invest') {
    const payoff = result.recommendation === 'payoff';
    return (
      <>
        <div className="mb-3">
          <Badge variant={payoff ? 'success' : 'purple'}>
            {payoff ? 'Melhor antecipar a dívida' : 'Melhor investir o dinheiro'}
          </Badge>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Metric label="Abatendo a dívida você economiza"><Money value={result.interestAvoided} /></Metric>
          <Metric label="Investindo você ganharia"><Money value={result.investmentEarnings} /></Metric>
          <Metric label="Diferença no período"><Money value={result.advantage} /></Metric>
          <Metric label="Vai para a dívida"><Money value={result.appliedToDebt} /></Metric>
          <Metric label="Taxa da dívida (mês)">{result.debtMonthlyRate}%</Metric>
          <Metric label="Taxa do investimento (mês)">{result.investmentMonthlyRate}%</Metric>
        </div>
        <p className="mt-3 text-xs text-muted">
          Compara, no mesmo horizonte de {result.horizonMonths} meses, os juros que você deixa de pagar x o que o dinheiro renderia investido.
        </p>
      </>
    );
  }
  // goal-plan
  return (
    <>
      {result.alreadyReached ? (
        <div className="mb-3"><Badge variant="success">Meta já alcançada 🎉</Badge></div>
      ) : (
        <div className="mb-4 rounded-2xl border border-primary/20 bg-primary-subtle/50 p-4 dark:bg-primary/5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Guarde por mês</p>
          <p className="mt-1 text-3xl font-black text-primary-dark dark:text-primary-hover"><Money value={result.monthlyContribution} /></p>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Metric label="Objetivo"><Money value={result.targetAmount} /></Metric>
        <Metric label="Você já tem"><Money value={result.currentAmount} /></Metric>
        <Metric label="Total que vai aportar"><Money value={result.totalContributed} /></Metric>
        <Metric label="Rendimento ajuda com"><Money value={result.interestEarned} /></Metric>
        <Metric label="Prazo">{result.months} meses</Metric>
      </div>
    </>
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
            {type === 'installment-cost' && (
              <>
                <FormGroup label="Preço à vista"><Input type="number" min="0" value={form.cashPrice} onChange={(event) => setField('cashPrice', event.target.value)} /></FormGroup>
                <FormGroup label="Valor de cada parcela"><Input type="number" min="0" value={form.installmentValue} onChange={(event) => setField('installmentValue', event.target.value)} /></FormGroup>
                <FormGroup label="Quantidade de parcelas"><Input type="number" min="1" value={form.installments} onChange={(event) => setField('installments', event.target.value)} /></FormGroup>
                <RateFields value={form.investmentRate} period={form.investmentRatePeriod} onValueChange={(value) => setField('investmentRate', value)} onPeriodChange={(value) => setField('investmentRatePeriod', value)} label="Rendimento se investir (opcional)" />
              </>
            )}
            {type === 'payoff-vs-invest' && (
              <>
                <FormGroup label="Saldo da dívida"><Input type="number" min="0" value={form.debtBalance} onChange={(event) => setField('debtBalance', event.target.value)} /></FormGroup>
                <RateFields value={form.debtRate} period={form.debtRatePeriod} onValueChange={(value) => setField('debtRate', value)} onPeriodChange={(value) => setField('debtRatePeriod', value)} label="Taxa da dívida" />
                <RateFields value={form.investmentRate} period={form.investmentRatePeriod} onValueChange={(value) => setField('investmentRate', value)} onPeriodChange={(value) => setField('investmentRatePeriod', value)} label="Taxa do investimento" />
                <FormGroup label="Valor extra disponível"><Input type="number" min="0" value={form.extraAmount} onChange={(event) => setField('extraAmount', event.target.value)} /></FormGroup>
                <FormGroup label="Horizonte (meses)"><Input type="number" min="1" value={form.horizonMonths} onChange={(event) => setField('horizonMonths', event.target.value)} /></FormGroup>
              </>
            )}
            {type === 'goal-plan' && (
              <>
                <FormGroup label="Quanto quer juntar"><Input type="number" min="0" value={form.targetAmount} onChange={(event) => setField('targetAmount', event.target.value)} /></FormGroup>
                <FormGroup label="Quanto já tem hoje"><Input type="number" min="0" value={form.currentAmount} onChange={(event) => setField('currentAmount', event.target.value)} /></FormGroup>
                <FormGroup label="Em quantos meses"><Input type="number" min="1" value={form.months} onChange={(event) => setField('months', event.target.value)} /></FormGroup>
                <RateFields value={form.investmentRate} period={form.investmentRatePeriod} onValueChange={(value) => setField('investmentRate', value)} onPeriodChange={(value) => setField('investmentRatePeriod', value)} label="Rendimento (opcional)" />
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
