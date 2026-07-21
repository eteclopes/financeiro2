import { useEffect, useId, useRef, useState } from 'react';

/**
 * Anima valores sem dependências externas. A animação é curta e só roda
 * quando o valor muda; respeita prefers-reduced-motion via CSS/MediaQuery.
 */
export function AnimatedNumber({ value = 0, formatter = (n) => n, duration = 760, className = '' }) {
  const numericValue = Number(value) || 0;
  const previous = useRef(numericValue);
  const [display, setDisplay] = useState(numericValue);

  useEffect(() => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (reduceMotion) {
      setDisplay(numericValue);
      previous.current = numericValue;
      return undefined;
    }

    const from = previous.current;
    const delta = numericValue - from;
    const startedAt = performance.now();
    let frame;

    const tick = (now) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 4);
      setDisplay(from + delta * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
      else previous.current = numericValue;
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [numericValue, duration]);

  return <span className={`tabular-nums ${className}`}>{formatter(display)}</span>;
}

/** Cards de escolha que funcionam como radio buttons acessíveis. */
export function ChoiceCards({
  options,
  value,
  onChange,
  name,
  columns = 3,
  compact = false,
  className = '',
}) {
  const generatedName = useId();
  const radioName = name ?? generatedName;
  // Evita cartões estreitos demais. Quando não houver largura confortável,
  // o grid reduz a quantidade de colunas em vez de esmagar texto e rádio.
  const minCardWidth = compact
    ? (columns >= 4 ? 236 : 220)
    : (columns >= 4 ? 244 : columns === 2 ? 230 : 220);

  return (
    <div
      className={`choice-grid ${className}`}
      style={{ '--choice-min-width': `${minCardWidth}px` }}
      data-choice-columns={columns}
      role="radiogroup"
    >
      {options.map((option) => {
        const selected = String(value) === String(option.value);
        return (
          <label
            key={option.value}
            className={`choice-card ${selected ? 'choice-card-selected' : ''} ${compact ? 'choice-card-compact' : ''} ${option.disabled ? 'opacity-45 cursor-not-allowed' : ''}`}
          >
            <input
              type="radio"
              name={radioName}
              value={option.value}
              checked={selected}
              disabled={option.disabled}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            <span className={`choice-card-icon ${option.tone ?? 'choice-card-icon-primary'}`} aria-hidden="true">
              {option.icon ?? '●'}
            </span>
            <span className="min-w-0 flex-1">
              <span className="choice-card-title">{option.label}</span>
              {option.description && <span className="choice-card-description">{option.description}</span>}
            </span>
            <span className="choice-card-radio" aria-hidden="true"><span /></span>
          </label>
        );
      })}
    </div>
  );
}

/** Controle segmentado com semântica de radio, ideal para visualizações/filtros. */
export function SegmentedControl({ options, value, onChange, label = 'Selecionar visualização', className = '' }) {
  return (
    <div className={`segmented-control ${className}`} role="radiogroup" aria-label={label}>
      {options.map((option) => {
        const active = String(value) === String(option.value);
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={`segmented-option ${active ? 'segmented-option-active' : ''}`}
          >
            {option.icon && <span aria-hidden="true">{option.icon}</span>}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function ToggleSwitch({ checked, onChange, label, description, disabled = false }) {
  return (
    <label className={`switch-row ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-800 dark:text-zinc-200">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-slate-500 dark:text-zinc-500">{description}</span>}
      </span>
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={`switch-track ${checked ? 'switch-track-on' : ''}`} aria-hidden="true">
        <span className="switch-thumb" />
      </span>
    </label>
  );
}

/** Spotlight leve baseado na posição do ponteiro. */
export function Spotlight({ children, className = '' }) {
  const ref = useRef(null);
  function move(event) {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    node.style.setProperty('--spot-x', `${event.clientX - rect.left}px`);
    node.style.setProperty('--spot-y', `${event.clientY - rect.top}px`);
  }

  return (
    <div ref={ref} onPointerMove={move} className={`spotlight-surface ${className}`}>
      {children}
    </div>
  );
}
