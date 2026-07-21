export default function AuthLayout({ eyebrow, title, children, footer }) {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-paper px-4 py-12">
      <div className="mb-10 text-center">
        <p className="font-display text-3xl italic text-pine">Cofre</p>
        <p className="mt-1 font-mono text-xs uppercase tracking-[0.2em] text-muted">
          gestão financeira pessoal
        </p>
      </div>

      <div className="w-full max-w-sm border border-rule bg-surface px-7 py-8">
        {eyebrow && (
          <p className="mb-1 font-mono text-xs uppercase tracking-[0.15em] text-muted">{eyebrow}</p>
        )}
        <h1 className="mb-6 font-display text-2xl text-ink">{title}</h1>
        {children}
      </div>

      {footer && <div className="mt-6 text-center text-sm text-muted">{footer}</div>}
    </div>
  );
}
