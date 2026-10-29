import type { ReactNode, Ref, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { ref?: Ref<HTMLButtonElement>; variant?: "primary" | "ghost" | "danger" | "outline"; size?: "sm" | "md" | "lg" }) {
  const base =
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background";
  const sizes = { sm: "h-9 px-4 text-xs", md: "h-10 px-5 text-sm", lg: "h-12 px-7 text-base" };
  const variants = {
    primary: "bg-accent text-background hover:bg-accent-hover",
    ghost: "text-foreground-2 hover:bg-white/10 hover:text-foreground",
    outline: "border border-foreground/40 bg-transparent text-foreground hover:border-foreground hover:bg-white/5",
    danger: "bg-rose-600/90 text-white hover:bg-rose-500",
  };
  return <button className={cx(base, sizes[size], variants[variant], className)} {...props} />;
}

const control =
  "w-full rounded-md border border-border bg-surface-2 text-sm text-foreground placeholder:text-subtle transition focus:border-foreground/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(control, "h-10 px-3", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(control, "px-3 py-2 leading-relaxed", className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(control, "h-10 px-3", className)} {...props} />;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-baseline justify-between gap-3 text-xs font-medium text-muted">
        <span>{label}</span>
        {hint && <span className="font-normal tabular-nums text-subtle">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export function Card({ className, children, title, action }: { className?: string; children: ReactNode; title?: string; action?: ReactNode }) {
  return (
    <section className={cx("rounded-xl border border-border bg-surface p-5", className)}>
      {(title || action) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-sm font-semibold tracking-wide text-foreground-2">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Badge({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", className)}>
      {children}
    </span>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="text-xs font-medium uppercase tracking-wider text-subtle">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-foreground">{value}</div>
      {sub && <div className="mt-1 text-xs text-subtle">{sub}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-subtle">{children}</div>;
}

/** Inline error. role="alert" so screen readers announce it when it appears. */
export function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="break-keep rounded-md bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
      {children}
    </p>
  );
}

/** Standard page container for document-like app pages (gallery, dashboard, admin). */
export function PageContainer({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("mx-auto w-full max-w-7xl px-4 py-8", className)}>{children}</div>;
}
