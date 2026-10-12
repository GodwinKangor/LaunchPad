import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-black hover:bg-accent/90 font-semibold',
  secondary: 'bg-raised text-ink border border-line hover:border-muted/60',
  ghost: 'text-muted hover:text-ink hover:bg-raised',
  danger: 'bg-bad/10 text-bad border border-bad/30 hover:bg-bad/20',
};

export function buttonClass(variant: Variant = 'secondary', size: 'sm' | 'md' = 'md'): string {
  return cx(
    'inline-flex items-center justify-center gap-2 rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50',
    size === 'sm' ? 'h-8 px-3 text-xs font-medium' : 'h-10 px-4 text-sm font-medium',
    VARIANTS[variant],
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({ variant, size, loading, icon, children, className, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={cx(buttonClass(variant, size), className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-xl border border-line bg-surface', className)}>{children}</div>;
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: ReactNode;
  error?: string;
  mono?: boolean;
}

export function Field({ label, hint, error, mono, id, name, className, ...rest }: FieldProps) {
  const fieldId = id ?? `field-${name}`;
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;
  return (
    <div className={className}>
      <label htmlFor={fieldId} className="mb-1.5 block text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={fieldId}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cx(
          'h-10 w-full rounded-lg border bg-bg px-3 text-sm text-ink placeholder:text-muted/60 transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-accent/60 disabled:opacity-60',
          error ? 'border-bad/60' : 'border-line hover:border-muted/50',
          mono && 'font-mono',
        )}
        {...rest}
      />
      {error ? (
        <p id={`${fieldId}-error`} className="mt-1.5 text-xs text-bad" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${fieldId}-hint`} className="mt-1.5 text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Alert({ tone = 'bad', title, children, action }: { tone?: 'bad' | 'warn' | 'info' | 'ok'; title?: string; children?: ReactNode; action?: ReactNode }) {
  const tones = {
    bad: 'border-bad/30 bg-bad/10 text-bad',
    warn: 'border-warn/30 bg-warn/10 text-warn',
    info: 'border-info/30 bg-info/10 text-info',
    ok: 'border-ok/30 bg-ok/10 text-ok',
  };
  return (
    <div role={tone === 'bad' ? 'alert' : 'status'} className={cx('flex items-start justify-between gap-4 rounded-lg border px-4 py-3 text-sm', tones[tone])}>
      <div className="min-w-0">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cx('break-words text-ink/80', title && 'mt-0.5')}>{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted" role="status">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      {label}…
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-line px-6 py-14 text-center">
      {icon && <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-raised text-muted">{icon}</div>}
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {children && <p className="mt-1.5 max-w-md text-sm text-muted">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-2 font-semibold tracking-tight text-ink', className)}>
      <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
        <rect width="24" height="24" rx="6" fill="rgb(var(--accent))" />
        <path d="M12 5.5l4.5 9h-3v4h-3v-4h-3z" fill="#0a0c0f" />
      </svg>
      LaunchPad
    </span>
  );
}
