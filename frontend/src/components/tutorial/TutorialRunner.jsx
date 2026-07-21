import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import './TutorialRunner.css';
import { useTutorialStore } from '../../store/tutorialStore';
import { useUIStore } from '../../store/uiStore';
import { TUTORIAL_STEPS } from '../../lib/tutorialSteps';
import { findVisibleTutorialElement, prepareTutorialStep } from '../../lib/tutorialDom';

const TOTAL_STEPS = TUTORIAL_STEPS.length;
const STEP_TIMEOUT = 4_500;

function decoratePopover(popover, index) {
  const step = TUTORIAL_STEPS[index];
  if (!step) return;

  const { wrapper, title, description, progress, previousButton, nextButton, closeButton } = popover;
  wrapper.dataset.tourStep = step.id;
  wrapper.classList.toggle('financehub-tour-welcome', index === 0);
  wrapper.style.setProperty('--tour-progress', `${((index + 1) / TOTAL_STEPS) * 100}%`);

  wrapper.querySelectorAll('.financehub-tour-progress-line, .financehub-tour-heading, .financehub-tour-features').forEach((node) => node.remove());

  closeButton.disabled = false;
  closeButton.setAttribute('aria-label', 'Fechar tutorial');
  closeButton.setAttribute('title', 'Fechar tutorial');
  closeButton.innerHTML = '<span aria-hidden="true">×</span>';

  const progressLine = document.createElement('div');
  progressLine.className = 'financehub-tour-progress-line';
  progressLine.setAttribute('aria-hidden', 'true');
  wrapper.insertBefore(progressLine, wrapper.firstChild);

  const heading = document.createElement('div');
  heading.className = 'financehub-tour-heading';
  heading.innerHTML = `
    <span class="financehub-tour-icon" aria-hidden="true">${step.icon ?? '✦'}</span>
    <span class="financehub-tour-kicker">${step.eyebrow ?? 'Tour guiado'}</span>
  `;
  wrapper.insertBefore(heading, title);

  progress.innerHTML = `
    <span class="financehub-tour-progress-current">${String(index + 1).padStart(2, '0')}</span>
    <span class="financehub-tour-progress-divider">/</span>
    <span>${String(TOTAL_STEPS).padStart(2, '0')}</span>
  `;

  previousButton.innerHTML = '<span aria-hidden="true">←</span><span>Voltar</span>';
  nextButton.innerHTML = index === TOTAL_STEPS - 1
    ? '<span>Finalizar</span><span aria-hidden="true">✓</span>'
    : '<span>Próximo</span><span aria-hidden="true">→</span>';

  if (index === 0) {
    const features = document.createElement('div');
    features.className = 'financehub-tour-features';
    features.innerHTML = `
      <span><i aria-hidden="true">✓</i> Sem trocar de página</span>
      <span><i aria-hidden="true">✓</i> Sem novas requisições</span>
      <span><i aria-hidden="true">✓</i> Feche quando quiser</span>
    `;
    description.insertAdjacentElement('afterend', features);
  }
}

function setPopoverBusy(isBusy) {
  const wrapper = document.querySelector('.financehub-tour-popover');
  if (!wrapper) return;

  wrapper.classList.toggle('financehub-tour-loading', isBusy);
  wrapper.setAttribute('aria-busy', String(isBusy));

  // O botão de fechar permanece sempre utilizável. A versão anterior
  // desabilitava todos os botões e podia prender o usuário numa espera.
  wrapper.querySelectorAll('.driver-popover-prev-btn, .driver-popover-next-btn').forEach((button) => {
    button.disabled = isBusy;
  });

  const closeButton = wrapper.querySelector('.driver-popover-close-btn');
  if (closeButton) closeButton.disabled = false;

  const next = wrapper.querySelector('.driver-popover-next-btn');
  if (isBusy && next) {
    next.innerHTML = '<span class="financehub-tour-button-spinner" aria-hidden="true"></span><span>Ajustando</span>';
  }
}

/**
 * Tutorial de rota única.
 *
 * Ele nunca navega entre páginas, portanto não dispara consultas adicionais e
 * não interfere no carregamento do backend. Se um alvo não ficar disponível em
 * poucos segundos, o tour é encerrado com segurança e o app continua normal.
 */
export function TutorialRunner() {
  const location = useLocation();
  const running = useTutorialStore((state) => state.running);
  const finish = useTutorialStore((state) => state.finish);
  const skip = useTutorialStore((state) => state.skip);
  const cancel = useTutorialStore((state) => state.cancel);
  const setStepIndex = useTutorialStore((state) => state.setStepIndex);
  const info = useUIStore((state) => state.info);

  const driverRef = useRef(null);
  const transitioningRef = useRef(false);
  const abortRef = useRef(null);

  useEffect(() => {
    if (!running) {
      abortRef.current?.abort();
      abortRef.current = null;
      driverRef.current?.destroy();
      driverRef.current = null;
      return undefined;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    let disposed = false;
    const initialWindowScroll = { x: window.scrollX, y: window.scrollY };
    const sidebarNav = document.querySelector('aside nav');
    const initialSidebarScroll = sidebarNav?.scrollTop ?? 0;

    const restoreScrollPosition = () => {
      window.requestAnimationFrame(() => {
        window.scrollTo(initialWindowScroll.x, initialWindowScroll.y);
        if (sidebarNav) sidebarNav.scrollTop = initialSidebarScroll;
      });
    };

    const closeTour = (mode, message) => {
      if (disposed) return;
      disposed = true;
      controller.abort();
      const activeDriver = driverRef.current;
      driverRef.current = null;
      activeDriver?.destroy();
      restoreScrollPosition();

      if (mode === 'finish') finish();
      else if (mode === 'skip') skip();
      else cancel();

      if (message) window.setTimeout(() => info(message), 0);
    };

    if (location.pathname !== '/dashboard') {
      closeTour('cancel', 'Abra o dashboard para iniciar o tutorial.');
      return undefined;
    }

    async function prepareIndex(index) {
      const step = TUTORIAL_STEPS[index];
      if (!step) return { status: 'missing', element: null };
      return prepareTutorialStep(step, { signal: controller.signal, timeout: STEP_TIMEOUT });
    }

    async function moveToAvailable(startIndex, direction) {
      if (transitioningRef.current || disposed) return;
      transitioningRef.current = true;
      setPopoverBusy(true);

      try {
        let index = startIndex;
        let skipped = 0;

        while (index >= 0 && index < TOTAL_STEPS && skipped < TOTAL_STEPS) {
          const prepared = await prepareIndex(index);
          if (prepared.status === 'ready') {
            const activeDriver = driverRef.current;
            if (!activeDriver || disposed) return;
            setStepIndex(index);
            activeDriver.moveTo(index);
            window.requestAnimationFrame(() => activeDriver.refresh());
            return;
          }

          // Apenas elementos realmente ocultos pelo breakpoint são pulados.
          // Timeout, erro ou alvo instável encerram o tutorial; nunca procuramos
          // páginas seguintes nem acumulamos chamadas ao backend.
          const maySkipForViewport = TUTORIAL_STEPS[index]?.skipIfHidden
            && (prepared.status === 'hidden' || prepared.status === 'not-visible');
          if (!maySkipForViewport) {
            closeTour('cancel', 'O tutorial foi pausado, mas o sistema continua funcionando normalmente. Você pode iniciá-lo novamente em Configurações.');
            return;
          }

          index += direction;
          skipped += 1;
        }

        if (direction > 0) closeTour('finish');
      } catch (error) {
        if (error?.name !== 'AbortError') {
          console.warn('[Tutorial] Etapa encerrada com segurança.', error);
          closeTour('cancel', 'O tutorial foi pausado para não interferir no carregamento do sistema.');
        }
      } finally {
        transitioningRef.current = false;
        setPopoverBusy(false);
      }
    }

    const steps = TUTORIAL_STEPS.map((step) => ({
      element: step.element
        ? () => findVisibleTutorialElement(step.element) ?? undefined
        : undefined,
      disableActiveInteraction: true,
      popover: {
        title: step.title,
        description: step.description,
        side: step.side === 'over' ? undefined : (step.side ?? 'bottom'),
        align: step.align ?? 'start',
        popoverClass: 'financehub-tour-popover',
      },
    }));

    const driverObj = driver({
      steps,
      animate: true,
      duration: 260,
      smoothScroll: true,
      allowClose: true,
      allowScroll: true,
      overlayClickBehavior: () => {},
      overlayColor: '#05030B',
      overlayOpacity: 0.72,
      stagePadding: 10,
      stageRadius: 18,
      popoverOffset: 16,
      disableActiveInteraction: true,
      allowKeyboardControl: true,
      showProgress: true,
      progressText: '{{current}} / {{total}}',
      nextBtnText: 'Próximo',
      prevBtnText: 'Voltar',
      doneBtnText: 'Finalizar',
      popoverClass: 'financehub-tour-popover',
      onPopoverRender: (popover, opts) => decoratePopover(popover, opts.index ?? 0),
      onNextClick: async (_element, _step, opts) => {
        const current = opts.state.activeIndex ?? 0;
        if (current >= TOTAL_STEPS - 1) {
          closeTour('finish');
          return;
        }
        await moveToAvailable(current + 1, 1);
      },
      onPrevClick: async (_element, _step, opts) => {
        const current = opts.state.activeIndex ?? 0;
        if (current <= 0) return;
        await moveToAvailable(current - 1, -1);
      },
      onCloseClick: () => closeTour('skip'),
      onDoneClick: () => closeTour('finish'),
    });

    driverRef.current = driverObj;

    (async () => {
      try {
        const prepared = await prepareIndex(0);
        if (disposed) return;
        if (prepared.status !== 'ready') {
          closeTour('cancel');
          return;
        }
        setStepIndex(0);
        driverObj.drive(0);
        window.requestAnimationFrame(() => driverObj.refresh());
      } catch (error) {
        if (error?.name !== 'AbortError') {
          console.warn('[Tutorial] Inicialização cancelada sem afetar o app.', error);
          closeTour('cancel');
        }
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
      if (driverRef.current === driverObj) driverRef.current = null;
      driverObj.destroy();
    };
  }, [running, location.pathname, finish, skip, cancel, setStepIndex, info]);

  return null;
}
