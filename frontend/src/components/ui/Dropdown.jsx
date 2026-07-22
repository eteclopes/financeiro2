import { useState, useRef, useEffect, useId, Children, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { IconChevronL } from '../icons';

/**
 * Dropdown customizado — substitui o <select> nativo nos lugares onde o
 * visual da lista aberta precisa ser controlado pelo app (tema dark/light,
 * animação, bordas arredondadas). Navegadores renderizam a lista de um
 * <select> nativo usando o estilo do sistema operacional, não o CSS da
 * página, por isso ela "destoa" mesmo com o resto do app already estilizado.
 *
 * A lista de opções é renderizada via Portal direto no <body>, posicionada
 * manualmente por coordenadas (getBoundingClientRect do botão). Isso é
 * necessário porque este componente é usado dentro de modais cujo corpo
 * tem overflow-y-auto (scroll interno) — um <ul> posicionado com
 * `position: absolute` relativo ao próprio dropdown fica PRESO dentro
 * desse contêiner de scroll (a lista "cresce para dentro" do espaço que
 * resta, em vez de flutuar livremente por cima de tudo). Renderizando no
 * body com posição calculada, a lista se comporta como um <select> nativo
 * de verdade: sempre por cima, nunca cortada/comprimida pelo pai.
 *
 * API pensada para ser um substituto direto de <select> com <option>:
 *   <Dropdown value={x} onChange={(e) => ...e.target.value}>
 *     <option value="a">A</option>
 *   </Dropdown>
 * O onChange recebe um evento sintético mínimo ({ target: { value } }) para
 * que todo código existente que faz `(e) => setX(e.target.value)` continue
 * funcionando sem nenhuma alteração.
 */
export function Dropdown({ value, onChange, children, className = '', placeholder, disabled = false, variant = 'default', lang }) {
  const [open, setOpen] = useState(false);
  // placement: 'down' (padrão) ou 'up', decidido dinamicamente conforme o
  // espaço livre acima/abaixo do botão no momento em que a lista abre.
  const [pos, setPos] = useState(null); // { top|bottom, left, width, maxHeight, placement }
  // Índice da opção realçada por teclado — separado de `value` porque o
  // usuário pode navegar com as setas sem ainda ter confirmado (Enter) uma
  // escolha diferente da atual.
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const triggerRef = useRef(null);
  const listRef = useRef(null);
  const listId = useId();

  // Extrai as opções a partir dos filhos <option>. Children.toArray (e não
  // Array.from) é obrigatório aqui: quando o JSX mistura um <option> fixo
  // com um {array.map(...)} como irmãos (ex.: <option value="">Selecione...
  // </option>{categorias.map(...)}), o React entrega `children` como um
  // array ANINHADO — [elementoFixo, [opção1, opção2, ...]] — e não um
  // array plano. Children.toArray faz o flatten recursivo desses arrays
  // aninhados, normalizando para uma lista plana de elementos reais.
  const options = Children.toArray(children)
    .filter(Boolean)
    .map((child) => ({
      value: child.props.value,
      label: child.props.children,
      disabled: child.props.disabled,
    }));

  const selected = options.find((o) => String(o.value) === String(value));

  // Constantes do cálculo de posicionamento: distância do trigger até a
  // lista, altura preferida (mesma do max-h-60 antigo) e uma margem de
  // segurança para não colar nas bordas da tela.
  const GAP = 6;
  const PREFERRED_HEIGHT = 240; // ~ max-h-60
  const VIEWPORT_MARGIN = 8;

  function updatePosition() {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportBottom = viewportTop + viewportHeight;
    const spaceBelow = viewportBottom - rect.bottom - GAP - VIEWPORT_MARGIN;
    const spaceAbove = rect.top - viewportTop - GAP - VIEWPORT_MARGIN;

    // Abre para baixo por padrão. Só vira para cima se não houver espaço
    // suficiente abaixo para a altura preferida E houver mais espaço
    // disponível acima — assim listas curtas não ficam "pulando" de
    // direção sem necessidade real.
    const shouldFlip = spaceBelow < PREFERRED_HEIGHT && spaceAbove > spaceBelow;
    const placement = shouldFlip ? 'up' : 'down';
    const availableSpace = shouldFlip ? spaceAbove : spaceBelow;
    const maxHeight = Math.max(Math.min(PREFERRED_HEIGHT, availableSpace), 120);

    const width = Math.min(rect.width, viewportWidth - (VIEWPORT_MARGIN * 2));
    const left = Math.min(
      Math.max(rect.left, viewportLeft + VIEWPORT_MARGIN),
      viewportLeft + viewportWidth - width - VIEWPORT_MARGIN,
    );

    setPos({
      placement,
      left,
      width,
      maxHeight,
      ...(placement === 'down'
        ? { top: rect.bottom + GAP }
        : { bottom: Math.max(VIEWPORT_MARGIN, window.innerHeight - rect.top + GAP) }),
    });
  }

  // Recalcula a posição assim que abre (antes do paint, para não "pular" na tela)
  // e sempre que a janela rolar ou for redimensionada enquanto estiver aberto —
  // isso é o que faz a lista "seguir" o botão mesmo dentro de um modal rolável.
  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    function handleReposition() { updatePosition(); }
    window.addEventListener('scroll', handleReposition, true);
    window.addEventListener('resize', handleReposition);
    window.visualViewport?.addEventListener('resize', handleReposition);
    window.visualViewport?.addEventListener('scroll', handleReposition);
    return () => {
      window.removeEventListener('scroll', handleReposition, true);
      window.removeEventListener('resize', handleReposition);
      window.visualViewport?.removeEventListener('resize', handleReposition);
      window.visualViewport?.removeEventListener('scroll', handleReposition);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e) {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target) &&
        listRef.current && !listRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    }
    function handleKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  function pick(optionValue) {
    onChange?.({ target: { value: optionValue } });
    setOpen(false);
  }

  function firstEnabledIndex() {
    return options.findIndex((o) => !o.disabled);
  }

  function lastEnabledIndex() {
    for (let i = options.length - 1; i >= 0; i -= 1) {
      if (!options[i].disabled) return i;
    }
    return -1;
  }

  function nextEnabledIndex(from, delta) {
    if (options.length === 0) return -1;
    let i = from;
    for (let step = 0; step < options.length; step += 1) {
      i = (i + delta + options.length) % options.length;
      if (!options[i].disabled) return i;
    }
    return from;
  }

  // Ao abrir via teclado/clique, realça a opção selecionada (ou a primeira
  // habilitada) — sem isso, a navegação por seta sempre começaria "do zero".
  function openAt(baseIndex) {
    const selectedIndex = options.findIndex((o) => String(o.value) === String(value));
    setHighlightedIndex(baseIndex ?? (selectedIndex >= 0 ? selectedIndex : firstEnabledIndex()));
    setOpen(true);
  }

  function handleTriggerKeyDown(e) {
    if (disabled) return;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        openAt();
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((i) => nextEnabledIndex(i, 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((i) => nextEnabledIndex(i, -1));
        break;
      case 'Home':
        e.preventDefault();
        setHighlightedIndex(firstEnabledIndex());
        break;
      case 'End':
        e.preventDefault();
        setHighlightedIndex(lastEnabledIndex());
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (highlightedIndex >= 0 && !options[highlightedIndex]?.disabled) {
          pick(options[highlightedIndex].value);
        }
        break;
      default:
        break;
    }
  }

  // Mantém a opção realçada visível ao navegar por teclado (a lista é
  // menor que a tela toda quando há muitas opções).
  useEffect(() => {
    if (!open || highlightedIndex < 0 || !listRef.current) return;
    const el = listRef.current.children[highlightedIndex];
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [open, highlightedIndex]);

  const triggerClass = variant === 'ghost'
    ? 'flex items-center justify-between gap-1.5 text-left cursor-pointer text-sm font-bold text-slate-800 dark:text-zinc-100 bg-transparent px-1.5 py-1 rounded-lg hover:bg-primary-subtle dark:hover:bg-primary/10 transition-colors'
    : 'input-base flex items-center justify-between gap-2 text-left cursor-pointer disabled:cursor-not-allowed';

  return (
    <div lang={lang} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && highlightedIndex >= 0 ? `${listId}-opt-${highlightedIndex}` : undefined}
        onClick={() => (open ? setOpen(false) : openAt())}
        onKeyDown={handleTriggerKeyDown}
        className={triggerClass}
      >
        <span className={`truncate ${!selected && variant !== 'ghost' ? 'text-slate-400 dark:text-zinc-500' : ''}`}>
          {selected ? selected.label : (placeholder ?? 'Selecione...')}
        </span>
        {variant !== 'ghost' && (
          <IconChevronL
            size={13}
            className={`shrink-0 text-muted transition-transform duration-200 -rotate-90 ${open ? 'rotate-90' : ''}`}
          />
        )}
      </button>

      {open && pos && createPortal(
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          lang={lang}
          style={{
            position: 'fixed',
            left: pos.left,
            ...(pos.placement === 'down' ? { top: pos.top } : { bottom: pos.bottom }),
            maxHeight: pos.maxHeight,
            // No modo "ghost" (seletor de mês na topbar) a lista é mais
            // estreita que o trigger às vezes — usamos min-width próprio
            // em vez de herdar a largura exata do botão.
            width: variant === 'ghost' ? undefined : pos.width,
            minWidth: variant === 'ghost' ? 160 : undefined,
          }}
          className={`z-[120] overflow-y-auto rounded-2xl border border-slate-200 dark:border-white/[0.08]
                     bg-white/95 dark:bg-[#1B1B26]/95 backdrop-blur-xl shadow-modal py-1.5 animate-scale-in
                     ${pos.placement === 'down' ? 'origin-top' : 'origin-bottom'}`}
        >
          {options.length === 0 && (
            <li className="px-3.5 py-2 text-sm text-muted">Nenhuma opção</li>
          )}
          {options.map((o, index) => {
            const isSelected = String(o.value) === String(value);
            const isHighlighted = index === highlightedIndex;
            return (
              <li
                key={String(o.value)}
                id={`${listId}-opt-${index}`}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => !o.disabled && pick(o.value)}
                className={`px-3.5 py-2 text-sm cursor-pointer transition-colors duration-100 truncate
                  ${o.disabled ? 'opacity-40 cursor-not-allowed' : ''}
                  ${isSelected
                    ? 'bg-primary-subtle dark:bg-primary/20 text-primary-dark dark:text-primary-hover font-semibold'
                    : isHighlighted
                      ? 'bg-primary-subtle/70 dark:bg-primary/[0.08] text-slate-700 dark:text-zinc-200'
                      : 'text-slate-700 dark:text-zinc-200 hover:bg-primary-subtle/70 dark:hover:bg-primary/[0.08]'}`}
              >
                {o.label}
              </li>
            );
          })}
        </ul>,
        document.body
      )}
    </div>
  );
}