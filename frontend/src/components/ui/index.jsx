import { LineChart, Line, ResponsiveContainer } from 'recharts';

const VARIANTS = {
  primary: 'bg-primary hover:bg-primary-dark text-white shadow-[0_10px_26px_-14px_rgb(124_58_237_/_0.85)] hover:shadow-[0_14px_34px_-16px_rgb(124_58_237_/_0.9)] hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.985]',
  danger: 'bg-danger hover:bg-danger-dark text-white shadow-[0_10px_26px_-16px_rgb(220_38_38_/_0.75)] hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.985]',
  outline: 'border border-primary bg-white text-primary hover:bg-primary-subtle hover:border-primary-dark dark:bg-transparent dark:border-primary/70 dark:text-primary-hover dark:hover:bg-primary/10',
  ghost: 'text-slate-600 hover:text-slate-950 hover:bg-slate-100 dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-white',
  success: 'bg-success hover:bg-success-dark text-white shadow-[0_10px_26px_-16px_rgb(22_163_74_/_0.7)] hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.985]',
  subtle: 'bg-primary-subtle text-primary-dark border border-primary/10 hover:bg-primary-muted dark:bg-primary/10 dark:text-primary-hover dark:border-primary/20',
};

const SIZES = {
  xs: 'px-2.5 py-1.5 text-xs rounded-lg',
  sm: 'px-3.5 py-2 text-xs rounded-xl',
  md: 'px-4 py-2.5 text-sm rounded-xl',
  lg: 'px-5 py-3 text-base rounded-xl',
};

export function Button({ children, variant = 'primary', size = 'md', loading, disabled, className = '', type = 'button', ...props }) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`btn-base ${VARIANTS[variant] ?? VARIANTS.primary} ${SIZES[size]} ${className}`}
      {...props}
    >
      {loading && <Spinner size="sm" />}
      {children}
    </button>
  );
}

export function Card({ children, className = '', padding = true, hover = false, ...props }) {
  return (
    <div
      {...props}
      className={`premium-card theme-transition ${padding ? 'p-5 sm:p-6' : ''} ${hover ? 'premium-card-hover cursor-pointer' : ''} ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, actions, className = '' }) {
  return (
    <div className={`flex items-start justify-between gap-4 mb-5 ${className}`}>
      <div className="min-w-0">
        <h3 className="font-bold tracking-tight text-slate-950 dark:text-white">{title}</h3>
        {subtitle && <p className="text-sm text-slate-500 dark:text-zinc-400 mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, actions, className = '' }) {
  return (
    <div className={`flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between ${className}`}>
      <div>
        {eyebrow && <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary mb-1.5">{eyebrow}</p>}
        <h2 className="text-2xl sm:text-[28px] leading-tight font-bold tracking-[-0.025em] text-slate-950 dark:text-white">{title}</h2>
        {description && <p className="mt-1.5 text-sm text-slate-500 dark:text-zinc-400 max-w-2xl">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const BADGE = {
  success: 'bg-success-subtle text-success-dark border border-success/20 dark:bg-success/10 dark:text-success-light dark:border-success/20',
  danger: 'bg-danger-subtle text-danger-dark border border-danger/20 dark:bg-danger/10 dark:text-danger-light dark:border-danger/20',
  warning: 'bg-warning-subtle text-warning-dark border border-warning/20 dark:bg-warning/10 dark:text-warning-light dark:border-warning/20',
  info: 'bg-info-subtle text-info-dark border border-info/20 dark:bg-info/10 dark:text-info-light dark:border-info/20',
  default: 'bg-slate-100 text-slate-600 border border-slate-200 dark:bg-white/5 dark:text-zinc-400 dark:border-white/10',
  purple: 'bg-primary-subtle text-primary-dark border border-primary/20 dark:bg-primary/10 dark:text-primary-hover dark:border-primary/20',
};

export function Badge({ children, variant = 'default', className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold leading-none ${BADGE[variant] ?? BADGE.default} ${className}`}>
      {children}
    </span>
  );
}

export function Spinner({ size = 'md' }) {
  const s = size === 'xs' ? 'h-3 w-3 border' : size === 'sm' ? 'h-3.5 w-3.5 border' : size === 'lg' ? 'h-8 w-8 border-2' : 'h-5 w-5 border-2';
  return <div className={`${s} border-current border-t-transparent rounded-full animate-spin shrink-0`} />;
}

export function Skeleton({ className = '' }) {
  return <div className={`shimmer-bg rounded-xl ${className}`} />;
}

export function EmptyState({ icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center animate-fade-in px-4">
      {icon && (
        <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-primary-subtle text-2xl text-primary dark:bg-primary/10 dark:text-primary-hover">
          {icon}
        </div>
      )}
      <p className="font-bold text-slate-800 dark:text-zinc-200">{title}</p>
      {description && <p className="text-sm text-slate-500 dark:text-zinc-400 mt-1.5 max-w-sm leading-relaxed">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ProgressBar({ value, max = 100, color = 'primary', height = 'h-2', className = '' }) {
  const pct = Math.min(Math.max((value / max) * 100, 0), 100);
  const COLORS = {
    primary: 'bg-gradient-to-r from-primary to-primary-light',
    success: 'bg-gradient-to-r from-success to-success-light',
    danger: 'bg-gradient-to-r from-danger to-danger-light',
    warning: 'bg-gradient-to-r from-warning-dark to-warning-light',
    info: 'bg-gradient-to-r from-info to-info-light',
    purple: 'bg-gradient-to-r from-primary to-accentpurple',
  };
  return (
    <div className={`w-full bg-slate-100 dark:bg-white/[0.06] rounded-full overflow-hidden ${height} ${className}`}>
      <div
        className={`h-full rounded-full transition-all duration-700 ease-smooth relative overflow-hidden ${COLORS[color] ?? COLORS.primary}`}
        style={{ width: `${pct}%` }}
      >
        <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent -translate-x-full animate-[shimmer_2.8s_infinite]" />
      </div>
    </div>
  );
}

const TONE_ACCENT = {
  positive: {
    text: 'text-success-dark dark:text-success-light',
    ring: 'hover:border-success/25 hover:shadow-[0_18px_42px_-28px_rgb(22_163_74_/_0.6)]',
    line: '#16A34A',
    chip: 'bg-success-subtle dark:bg-success/10 text-success-dark dark:text-success-light',
    icon: 'bg-success-subtle text-success-dark dark:bg-success/10 dark:text-success-light',
  },
  negative: {
    text: 'text-danger-dark dark:text-danger-light',
    ring: 'hover:border-danger/25 hover:shadow-[0_18px_42px_-28px_rgb(220_38_38_/_0.65)]',
    line: '#DC2626',
    chip: 'bg-danger-subtle dark:bg-danger/10 text-danger-dark dark:text-danger-light',
    icon: 'bg-danger-subtle text-danger-dark dark:bg-danger/10 dark:text-danger-light',
  },
  neutral: {
    text: 'text-primary-dark dark:text-primary-hover',
    ring: 'hover:border-primary/25 hover:shadow-glow',
    line: '#7C3AED',
    chip: 'bg-primary-subtle dark:bg-primary/10 text-primary-dark dark:text-primary-hover',
    icon: 'bg-primary-subtle text-primary-dark dark:bg-primary/10 dark:text-primary-hover',
  },
  warning: {
    text: 'text-warning-dark dark:text-warning-light',
    ring: 'hover:border-warning/25 hover:shadow-[0_18px_42px_-28px_rgb(245_158_11_/_0.6)]',
    line: '#F59E0B',
    chip: 'bg-warning-subtle dark:bg-warning/10 text-warning-dark dark:text-warning-light',
    icon: 'bg-warning-subtle text-warning-dark dark:bg-warning/10 dark:text-warning-light',
  },
};

export function StatCard({ label, value, tone = 'neutral', icon, subtitle, trend, spark, className = '' }) {
  const accent = TONE_ACCENT[tone] ?? TONE_ACCENT.neutral;
  const hasTrend = trend !== undefined && trend !== null;
  const trendUp = hasTrend && trend >= 0;

  return (
    <div className={`group premium-card premium-card-hover overflow-hidden p-5 ${accent.ring} animate-fade-in ${className}`}>
      <div className="pointer-events-none absolute -right-10 -top-12 h-28 w-28 rounded-full bg-primary/5 blur-2xl transition-opacity group-hover:bg-primary/10" />
      <div className="relative flex items-start justify-between mb-3">
        <p className="text-[11px] font-bold text-slate-500 dark:text-zinc-500 uppercase tracking-[0.12em] leading-none">{label}</p>
        {icon && (
          <span className={`text-lg w-9 h-9 rounded-xl flex items-center justify-center ${accent.icon} group-hover:scale-105 transition-transform duration-300`}>
            {icon}
          </span>
        )}
      </div>
      <p className={`relative text-[26px] leading-none font-bold font-mono tabular-nums tracking-tight ${accent.text}`}>{value}</p>
      <div className="relative flex items-end justify-between mt-3 min-h-[28px]">
        {hasTrend ? (
          <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg ${accent.chip}`}>
            {trendUp ? '↗' : '↘'} {Math.abs(trend).toFixed(1)}%
          </span>
        ) : subtitle ? (
          <p className="text-xs text-slate-500 dark:text-zinc-400 line-clamp-1">{subtitle}</p>
        ) : <span />}

        {Array.isArray(spark) && spark.length > 1 && (
          <div className="w-20 h-8 opacity-80 group-hover:opacity-100 transition-opacity duration-200">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={spark.map((v, i) => ({ i, v }))}>
                <Line type="monotone" dataKey="v" stroke={accent.line} strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

const ALERT_STYLES = {
  info: 'bg-info-subtle border-info/25 text-info-dark dark:bg-info/10 dark:text-info-light dark:border-info/20',
  warning: 'bg-warning-subtle border-warning/25 text-warning-dark dark:bg-warning/10 dark:text-warning-light dark:border-warning/20',
  danger: 'bg-danger-subtle border-danger/25 text-danger-dark dark:bg-danger/10 dark:text-danger-light dark:border-danger/20',
  success: 'bg-success-subtle border-success/25 text-success-dark dark:bg-success/10 dark:text-success-light dark:border-success/20',
};

export function AlertBanner({ type = 'info', children }) {
  return <div className={`flex items-start gap-2.5 px-4 py-3.5 rounded-xl border text-sm leading-relaxed ${ALERT_STYLES[type]}`}>{children}</div>;
}

export function Divider({ className = '' }) {
  return <hr className={`border-slate-200 dark:border-white/[0.07] ${className}`} />;
}

export function TabGroup({ tabs, value, onChange }) {
  return (
    <div className="flex max-w-full gap-1 overflow-x-auto bg-slate-100/90 dark:bg-white/[0.045] p-1 rounded-xl border border-slate-200/70 dark:border-white/[0.06]">
      {tabs.map((tab) => {
        const active = value === tab.value;
        return (
          <button
            key={tab.value}
            onClick={() => onChange(tab.value)}
            className={`relative whitespace-nowrap px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${active ? 'bg-white text-primary-dark shadow-sm dark:bg-primary/18 dark:text-primary-hover' : 'text-slate-500 hover:text-slate-900 dark:text-zinc-500 dark:hover:text-zinc-200'}`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${active ? 'bg-primary-subtle text-primary-dark dark:bg-primary/20 dark:text-primary-hover' : 'bg-slate-200/80 dark:bg-white/10 text-slate-500 dark:text-zinc-500'}`}>
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
