/**
 * Ícones SVG inline, no estilo "line icons" (1.75–2px stroke, cantos
 * arredondados) usados no novo visual premium do app. Não dependem de
 * nenhuma biblioteca externa (lucide-react não está instalado no projeto) —
 * são componentes simples que aceitam `className` e `size` como qualquer
 * outro ícone React.
 */
function base(paths, props) {
  const { size = 18, className = '', strokeWidth = 1.75, ...rest } = props;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...rest}
    >
      {paths}
    </svg>
  );
}

export const IconDashboard = (p) => base(<><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>, p);
export const IconIncome    = (p) => base(<><path d="M12 19V5" /><path d="M5 12l7-7 7 7" /></>, p);
export const IconExpense   = (p) => base(<><path d="M12 5v14" /><path d="M19 12l-7 7-7-7" /></>, p);
export const IconCard      = (p) => base(<><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M2.5 10h19" /></>, p);
export const IconWallet    = (p) => base(<><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h11A2.5 2.5 0 0 1 19 7.5V8H5.5A2.5 2.5 0 0 1 3 5.5" /><rect x="3" y="8" width="18" height="11" rx="2.5" /><circle cx="16" cy="13.5" r="1.4" /></>, p);
export const IconGoal      = (p) => base(<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.3" fill="currentColor" /></>, p);
export const IconSimulator = (p) => base(<><rect x="4" y="2.5" width="16" height="19" rx="2.5" /><path d="M8 7h8M8 11h3M13 11h3M8 15h3M13 15h3" /></>, p);
export const IconHistory   = (p) => base(<><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4.5V9h4.5" /><path d="M12 7v5l3.5 2" /></>, p);
export const IconReport    = (p) => base(<><path d="M5 3h9l5 5v13H5z" /><path d="M14 3v5h5" /><path d="M8.5 13h7M8.5 16.5h4.5" /></>, p);
export const IconSettings  = (p) => base(<><circle cx="12" cy="12" r="3" /><path d="M19.4 13.5a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V19.6a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.1-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H4.4a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H10.5a1.7 1.7 0 0 0 1.03-1.56V4.4a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V10.5a1.7 1.7 0 0 0 1.56 1.03h.09a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.03z" /></>, p);
export const IconLogout    = (p) => base(<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></>, p);
export const IconMenu      = (p) => base(<><path d="M4 6h16M4 12h16M4 18h16" /></>, p);
export const IconSearch    = (p) => base(<><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>, p);
export const IconBell      = (p) => base(<><path d="M18 8a6 6 0 1 0-12 0c0 4-2 5-2 6h16c0-1-2-2-2-6" /><path d="M9.5 21a2.5 2.5 0 0 0 5 0" /></>, p);
export const IconSun       = (p) => base(<><circle cx="12" cy="12" r="4.5" /><path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" /></>, p);
export const IconMoon      = (p) => base(<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4 7 7 0 0 0 20 14.5z" />, p);
export const IconChevronL  = (p) => base(<path d="M14.5 18l-6-6 6-6" />, p);
export const IconChevronR  = (p) => base(<path d="M9.5 18l6-6-6-6" />, p);
export const IconUp        = (p) => base(<><path d="M5 17l6-6 4 4 6-8" /><path d="M21 7v4M17 7h4" /></>, p);
export const IconDown      = (p) => base(<><path d="M5 7l6 6 4-4 6 8" /><path d="M21 17v-4M17 17h4" /></>, p);
export const IconScale     = (p) => base(<><path d="M12 3v18" /><path d="M5 8l-2 6a3 3 0 0 0 6 0z" /><path d="M19 8l-2 6a3 3 0 0 0 6 0z" /><path d="M5 8h14" /><path d="M12 3l-3 3M12 3l3 3" /></>, p);
export const IconPiggy     = (p) => base(<><path d="M4 13a6 6 0 0 1 6-6h6.5L20 9.5v3L17.5 14H16v3h-2.5v-2.5H10A6 6 0 0 1 4 13z" /><circle cx="14.5" cy="11" r=".6" fill="currentColor" /><path d="M8.5 16v2.2M5.7 14.5l-1.6 1.4" /></>, p);
export const IconAlert     = (p) => base(<><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 4.4 2.7 18a1.6 1.6 0 0 0 1.4 2.4h15.8a1.6 1.6 0 0 0 1.4-2.4L13.7 4.4a1.6 1.6 0 0 0-2.8 0z" /></>, p);
export const IconCheck     = (p) => base(<path d="M4 12l5 5L20 6" />, p);
export const IconTrend     = (p) => base(<><path d="M3 17l6-6 4 4 8-9" /><path d="M15 6h6v6" /></>, p);
export const IconBudget    = (p) => base(<><circle cx="12" cy="12" r="9" /><path d="M12 12 12 5.5" /><path d="M12 12l5 3" /></>, p);