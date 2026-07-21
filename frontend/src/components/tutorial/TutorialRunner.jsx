import { useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import './TutorialRunner.css';
import { useTutorialStore } from '../../store/tutorialStore';
import { TUTORIAL_STEPS } from '../../lib/tutorialSteps';
import {
  findVisibleTutorialElement,
  prepareTutorialStep,
  waitForTutorialRoute,
} from '../../lib/tutorialDom';

const TOTAL_STEPS = TUTORIAL_STEPS.length;

function decoratePopover(popover, index) {
  const step = TUTORIAL_STEPS[index];
  if (!step) return;

  const { wrapper, title, description, progress, previousButton, nextButton, closeButton } = popover;
  wrapper.dataset.tourStep = step.id;
  wrapper.style.setProperty('--tour-progress', `${((index + 1) / TOTAL_STEPS) * 100}%`);

  closeButton.setAttribute('aria-label', 'Pular tutorial');
  closeButton.setAttribute('title', 'Pular tutorial');
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
    wrapper.classList.add('financehub-tour-welcome');
    const features = document.createElement('div');
    features.className = 'financehub-tour-features';
    features.innerHTML = `
      <span><i aria-hidden="true">✓</i> Fluxo guiado</span>
      <span><i aria-hidden="true">✓</i> Sem alterar seus dados</span>
      <span><i aria-hidden="true">✓</i> Menos de 2 minutos</span>
    `;
    description.insertAdjacentElement('afterend', features);
  }
}

function setPopoverBusy(isBusy) {
  const wrapper = document.querySelector('.financehub-tour-popover');
  if (!wrapper) return;
  wrapper.classList.toggle('financehub-tour-loading', isBusy);
  wrapper.setAttribute('aria-busy', String(isBusy));
  wrapper.querySelectorAll('button').forEach((button) => {
    button.disabled = isBusy;
  });
  const next = wrapper.querySelector('.driver-popover-next-btn');
  if (isBusy && next) next.innerHTML = '<span class="financehub-tour-button-spinner" aria-hidden="true"></span><span>Carregando</span>';
}

/**
 * Tour multi-rota com sincronização real. A navegação só avança depois que a
 * rota terminou de renderizar, os skeletons sumiram e o alvo ficou estável.
 */
export function TutorialRunner() {
  const navigate = useNavigate();
  const location = useLocation();
  const running = useTutorialStore((state) => state.running);
  const finish = useTutorialStore((state) => state.finish);
  const skip = useTutorialStore((state) => state.skip);
  const cancel = useTutorialStore((state) => state.cancel);
  const setStepIndex = useTutorialStore((state) => state.setStepIndex);

  const driverRef = useRef(null);
  const locationRef = useRef(location.pathname);
  const transitioningRef = useRef(false);
  const abortRef = useRef(null);

  useEffect(() => {
    locationRef.current = location.pathname;
  }, [location.pathname]);

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

    const closeTour = (mode) => {
      if (disposed) return;
      disposed = true;
      controller.abort();
      const activeDriver = driverRef.current;
      driverRef.current = null;
      activeDriver?.destroy();
      if (mode === 'finish') finish();
      else if (mode === 'skip') skip();
      else cancel();
    };

    async function prepareIndex(index) {
      const step = TUTORIAL_STEPS[index];
      if (!step) return { status: 'missing', element: null };

      if (locationRef.current !== step.route || window.location.pathname !== step.route) {
        navigate(step.route);
        const arrived = await waitForTutorialRoute(step.route, { signal: controller.signal });
        if (!arrived) return { status: 'timeout', element: null };
      }

      return prepareTutorialStep(step, { signal: controller.signal });
    }

    async function moveToAvailable(startIndex, direction) {
      if (transitioningRef.current || disposed) return;
      transitioningRef.current = true;
      setPopoverBusy(true);
      document.documentElement.classList.add('tutorial-route-transition');

      try {
        let index = startIndex;
        while (index >= 0 && index < TOTAL_STEPS) {
          const prepared = await prepareIndex(index);
          if (prepared.status === 'ready') {
            const activeDriver = driverRef.current;
            if (!activeDriver || disposed) return;
            setStepIndex(index);
            activeDriver.moveTo(index);
            window.requestAnimationFrame(() => activeDriver.refresh());
            return;
          }

          // Elementos ocultos por breakpoint ou indisponíveis em uma tela
          // vazia não travam o restante do tour.
          if (index === 0) {
            closeTour('cancel');
            return;
          }
          index += direction;
        }

        if (direction > 0) closeTour('finish');
      } catch (error) {
        if (error?.name !== 'AbortError') {
          console.warn('[Tutorial] Não foi possível preparar o próximo passo.', error);
          closeTour('cancel');
        }
      } finally {
        transitioningRef.current = false;
        setPopoverBusy(false);
        document.documentElement.classList.remove('tutorial-route-transition');
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
      duration: 340,
      smoothScroll: true,
      allowClose: true,
      allowScroll: false,
      overlayClickBehavior: () => {},
      overlayColor: '#05030B',
      overlayOpacity: 0.76,
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
          console.warn('[Tutorial] O tour aguardará uma próxima tentativa.', error);
          closeTour('cancel');
        }
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
      document.documentElement.classList.remove('tutorial-route-transition');
      if (driverRef.current === driverObj) driverRef.current = null;
      driverObj.destroy();
    };
    // O runner controla navegação e localização por refs para não recriar o
    // Driver.js em cada mudança de rota durante o próprio tour.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  return null;
}
