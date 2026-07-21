import { useEffect, useRef } from 'react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';

// ── Button ──────────────────────────────────────────────────
const VARIANTS = {
  primary: 'bg-primary hover:bg-primary-dark text-white shadow-sm hover:shadow-md active:scale-[0.98]',
  danger:  'bg-danger hover:bg-danger-dark text-white shadow-sm active:scale-[0.98]',
  outline: 'border border-border bg-white hover:bg-subtle text-slate-700 hover:border-slate-300 dark:bg-panel-dark dark:border-white/10 dark:text-zinc-200 dark:hover:bg-white/5',
  ghost:   'hover:bg-subtle text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-zinc-100',
  success: 'bg-primary-subtle text-primary-dark border border-primary/20 hover:bg-primary-muted',
};
const SIZES = {
  xs: 'px-2.5 py-1 text-xs rounded-lg',
  sm: 'px-3.5 py-1.5 text-xs rounded-xl',
  md: 'px-4 py-2.5 text-sm rounded-xl',
  lg: 'px-5 py-3 text-base rounded-xl',
};

export function Button({ children, variant = 'primary', size = 'md', loading, disabled, className = '', type = 'button', ...props }) {
  return (
    <button type={type} disabled={disabled || loading}
      className={`btn-base ${VARIANTS[variant] ?? VARIANTS.primary} ${SIZES[size]} ${className}`}
      {...props}>
      {loading && <Spinner size="sm" />}
      {children}
    </button>
  );
}

// ── Card ────────────────────────────────────────────────────
export function Card({ children, className = '', padding = true, hover = false, ...props }) {
  return (
    <div {...props} className={`bg-white dark:bg-panel-dark rounded-2xl border border-border dark:border-white/[0.06] shadow-card dark:shadow-premium-dark theme-transition ${padding ? 'p-5' : ''} ${hover ? 'transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 cursor-pointer' : ''} ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, actions, className = '' }) {
  return (
    <div className={`flex items-start justify-between mb-5 ${className}`}>
      <div>
        <h3 className="font-semibold text-slate-900 dark:text-zinc-50">{title}</h3>
        {subtitle && <p className="text-sm text-muted mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2 shrink-0 ml-4">{actions}</div>}
    </div>
  );
}

// ── Badge ───────────────────────────────────────────────────
const BADGE = {
  success: 'bg-primary-subtle text-primary-dark border border-primary/20 dark:bg-primary/10 dark:text-primary-light dark:border-primary/25',
  danger:  'bg-danger-subtle text-danger-dark border border-danger/20 dark:bg-danger/10 dark:text-danger-light dark:border-danger/25',
  warning: 'bg-warning-subtle text-warning-dark border border-warning/20 dark:bg-warning/10 dark:text-warning-light dark:border-warning/25',
  info:    'bg-info-subtle text-info-dark border border-info/20 dark:bg-info/10 dark:text-info-light dark:border-info/25',
  default: 'bg-subtle text-slate-600 border border-border dark:bg-white/5 dark:text-zinc-400 dark:border-white/10',
  purple:  'bg-purple-50 text-purple-700 border border-purple-200 dark:bg-accentpurple/10 dark:text-accentpurple-light dark:border-accentpurple/25',
};

export function Badge({ children, variant = 'default', className = '' }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${BADGE[variant] ?? BADGE.default} ${className}`}>
      {children}
    </span>
  );
}

// ── Spinner ─────────────────────────────────────────────────
export function Spinner({ size = 'md' }) {
  const s = size === 'xs' ? 'h-3 w-3 border' : size === 'sm' ? 'h-3.5 w-3.5 border' : size === 'lg' ? 'h-8 w-8 border-2' : 'h-5 w-5 border-2';
  return <div className={`${s} border-current border-t-transparent rounded-full animate-spin shrink-0`} />;
}

// ── Skeleton ─────────────────────────────────────────────────
export function Skeleton({ className = '' }) {
  return <div className={`shimmer-bg rounded-xl ${className}`} />;
}

// ── Empty State ──────────────────────────────────────────────
export function EmptyState({ icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center animate-fade-in px-4">
      {icon && <div className="text-4xl mb-4 opacity-40">{icon}</div>}
      <p className="font-semibold text-slate-700 dark:text-zinc-300">{title}</p>
      {description && <p className="text-sm text-muted mt-1.5 max-w-xs">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// ── Progress Bar ─────────────────────────────────────────────
export function ProgressBar({ value, max = 100, color = 'primary', height = 'h-2', className = '' }) {
  const pct = Math.min(Math.max((value / max) * 100, 0), 100);
  const COLORS = { primary: 'bg-primary', danger: 'bg-danger', warning: 'bg-warning', info: 'bg-info', purple: 'bg-purple-500' };
  return (
    <div className={`w-full bg-subtle dark:bg-white/5 rounded-full overflow-hidden ${height} ${className}`}>
      <div
        className={`h-full rounded-full transition-all duration-500 ease-smooth ${COLORS[color] ?? 'bg-primary'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ── Stat Card (métrica do dashboard) ─────────────────────────
// Retrocompatível: quem já usa <StatCard label value tone icon subtitle />
// continua funcionando exatamente igual. `trend` e `spark` são novos e
// opcionais — só aparecem quando informados, sem afetar quem não os passa.
const TONE_ACCENT = {
  positive: { text: 'text-primary-dark dark:text-primary-light', ring: 'group-hover:shadow-glow', line: '#10B981', chip: 'bg-primary-subtle dark:bg-primary/10 text-primary-dark dark:text-primary-light' },
  negative: { text: 'text-danger-dark dark:text-danger-light',   ring: 'group-hover:shadow-[0_0_20px_rgb(239,68,68,0.15)]', line: '#EF4444', chip: 'bg-danger-subtle dark:bg-danger/10 text-danger-dark dark:text-danger-light' },
  neutral:  { text: 'text-slate-900 dark:text-zinc-50',          ring: 'group-hover:shadow-md', line: '#3B82F6', chip: 'bg-subtle dark:bg-white/5 text-muted' },
  warning:  { text: 'text-warning-dark dark:text-warning-light', ring: 'group-hover:shadow-[0_0_20px_rgb(245,158,11,0.15)]', line: '#F59E0B', chip: 'bg-warning-subtle dark:bg-warning/10 text-warning-dark dark:text-warning-light' },
};

export function StatCard({ label, value, tone = 'neutral', icon, subtitle, trend, spark, className = '' }) {
  const accent = TONE_ACCENT[tone] ?? TONE_ACCENT.neutral;
  const hasTrend = trend !== undefined && trend !== null;
  const trendUp = hasTrend && trend >= 0;

  return (
    <div className={`group relative overflow-hidden bg-white/90 dark:bg-panel-dark/90 backdrop-blur-sm rounded-2xl border border-border dark:border-white/[0.06]
      shadow-card dark:shadow-premium-dark theme-transition p-4 transition-all duration-300 ease-smooth
      hover:-translate-y-1 ${accent.ring} animate-fade-in ${className}`}>
      <div className="flex items-start justify-between mb-2">
        <p className="text-xs font-semibold text-muted uppercase tracking-wider leading-none">{label}</p>
        {icon && (
          <span className="text-lg w-7 h-7 rounded-lg flex items-center justify-center bg-subtle dark:bg-white/5 opacity-80 group-hover:opacity-100 group-hover:scale-110 transition-all duration-200">
            {icon}
          </span>
        )}
      </div>

      <p className={`text-2xl font-bold font-mono tabular-nums ${accent.text} transition-colors duration-200`}>{value}</p>

      <div className="flex items-center justify-between mt-1.5 min-h-[20px]">
        {hasTrend ? (
          <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold px-1.5 py-0.5 rounded-md ${accent.chip}`}>
            {trendUp ? '↑' : '↓'} {Math.abs(trend).toFixed(1)}%
          </span>
        ) : subtitle ? (
          <p className="text-xs text-muted">{subtitle}</p>
        ) : <span />}

        {Array.isArray(spark) && spark.length > 1 && (
          <div className="w-16 h-7 opacity-70 group-hover:opacity-100 transition-opacity duration-200">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={spark.map((v, i) => ({ i, v }))}>
                <Line type="monotone" dataKey="v" stroke={accent.line} strokeWidth={1.75} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Alert Banner ─────────────────────────────────────────────
const ALERT_STYLES = {
  info:    'bg-info-subtle border-info/30 text-info-dark',
  warning: 'bg-warning-subtle border-warning/30 text-warning-dark',
  danger:  'bg-danger-subtle border-danger/30 text-danger-dark',
  success: 'bg-primary-subtle border-primary/30 text-primary-dark',
};
export function AlertBanner({ type = 'info', children }) {
  return <div className={`flex items-start gap-2.5 px-4 py-3 rounded-xl border text-sm ${ALERT_STYLES[type]}`}>{children}</div>;
}

// ── Divider ──────────────────────────────────────────────────
export function Divider({ className = '' }) {
  return <hr className={`border-border ${className}`} />;
}

// ── Tab Group ────────────────────────────────────────────────
export function TabGroup({ tabs, value, onChange }) {
  return (
    <div className="flex gap-1 bg-subtle dark:bg-white/5 p-1 rounded-xl w-fit">
      {tabs.map((tab) => (
        <button key={tab.value} onClick={() => onChange(tab.value)}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 ${value === tab.value ? 'bg-white dark:bg-panel-dark shadow-sm text-slate-900 dark:text-zinc-50' : 'text-muted hover:text-slate-700 dark:hover:text-zinc-200'}`}>
          {tab.label}
          {tab.count !== undefined && (
            <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${value === tab.value ? 'bg-subtle dark:bg-white/10 text-muted' : 'bg-border dark:bg-white/10 text-muted'}`}>
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}