import { useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { useTutorialStore } from '../../store/tutorialStore';
import { TUTORIAL_STEPS } from '../../lib/tutorialSteps';

const NAV_SETTLE_MS = 350; // tempo pra rota nova renderizar antes do Driver.js procurar o elemento

/**
 * O Driver.js sozinho só sabe destacar elementos que já existem no DOM —
 * não tem noção de "rota do React Router". Como o tour passa por várias
 * páginas, cada passo em tutorialSteps.js tem uma `route`; este componente
 * intercepta "Próximo"/"Voltar" para navegar para a rota do passo seguinte
 * ANTES de pedir pro Driver.js procurar o elemento e mover o destaque.
 * `waitForElement` no config dá uma margem extra caso a navegação/render
 * ainda não tenha terminado no exato instante em que o Driver.js procura.
 */
export function TutorialRunner() {
  const navigate = useNavigate();
  const location = useLocation();
  const running = useTutorialStore((s) => s.running);
  const finish = useTutorialStore((s) => s.finish);
  const skip = useTutorialStore((s) => s.skip);
  const driverRef = useRef(null);
  const locationRef = useRef(location.pathname);

  useEffect(() => { locationRef.current = location.pathname; }, [location.pathname]);

  useEffect(() => {
    if (!running) {
      driverRef.current?.destroy();
      driverRef.current = null;
      return;
    }

    async function goToStepRoute(index) {
      const step = TUTORIAL_STEPS[index];
      if (!step) return;
      if (step.route !== locationRef.current) {
        navigate(step.route);
        await new Promise((resolve) => setTimeout(resolve, NAV_SETTLE_MS));
      }
    }

    const driverObj = driver({
      showProgress: true,
      progressText: '{{current}} de {{total}}',
      nextBtnText: 'Próximo',
      prevBtnText: 'Voltar',
      doneBtnText: 'Concluir',
      allowClose: true,
      overlayOpacity: 0.65,
      stagePadding: 6,
      stageRadius: 10,
      waitForElement: 1200,
      steps: TUTORIAL_STEPS.map((step) => ({
        element: step.element ? () => document.querySelector(step.element) ?? undefined : undefined,
        popover: {
          title: step.title,
          description: step.description,
          side: step.side ?? 'bottom',
          align: 'start',
        },
      })),
      onNextClick: async (_el, _step, opts) => {
        const current = opts.state.activeIndex ?? 0;
        if (!driverObj.hasNextStep()) { driverObj.destroy(); return; }
        await goToStepRoute(current + 1);
        driverObj.moveNext();
      },
      onPrevClick: async (_el, _step, opts) => {
        const current = opts.state.activeIndex ?? 0;
        if (current === 0) return;
        await goToStepRoute(current - 1);
        driverObj.movePrevious();
      },
      onCloseClick: () => { skip(); driverObj.destroy(); },
      onDestroyed: () => { finish(); },
    });

    driverRef.current = driverObj;

    (async () => {
      await goToStepRoute(0);
      driverObj.drive(0);
    })();

    return () => { driverObj.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  return null;
}
