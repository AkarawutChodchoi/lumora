import type { ReactNode } from "react";

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`rounded-2xl border border-line bg-card ${className}`}>{children}</div>;
}

const badgeTones = {
  neutral: "bg-chip text-muted",
  accent: "bg-accent-deep text-accent-ink",
  ok: "bg-free-bg text-free",
  warn: "bg-warn-bg text-warn",
  danger: "bg-danger-bg text-danger-soft",
};

export function Badge({ tone = "neutral", children, className = "" }: { tone?: keyof typeof badgeTones; children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-[3px] text-xs font-semibold whitespace-nowrap ${badgeTones[tone]} ${className}`}>{children}</span>;
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line2 px-6 py-12 text-center">
      {icon && <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent-ink">{icon}</div>}
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", description, action }: { title?: string; description?: string; action?: ReactNode }) {
  return (
    <div role="alert" className="rounded-2xl border border-danger/30 bg-danger-bg/50 px-6 py-10 text-center">
      <h3 className="font-display text-lg font-semibold text-danger-soft">{title}</h3>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-lg ${className}`} aria-hidden="true" />;
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-2xl font-bold sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

const GRADIENTS = [
  "from-amber-500 to-orange-700",
  "from-rose-500 to-fuchsia-700",
  "from-sky-500 to-indigo-700",
  "from-violet-500 to-purple-800",
  "from-emerald-500 to-teal-700",
  "from-red-500 to-rose-800",
];

function hash(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

/** Portrait with a generated gradient + initial fallback, so no stock imagery is needed. */
export function Avatar({ name, src, className = "size-10", rounded = "rounded-full" }: { name: string; src?: string | null; className?: string; rounded?: string }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- user-supplied external URLs; next/image would need a domain allowlist
    return <img src={src} alt="" className={`${className} ${rounded} shrink-0 object-cover`} referrerPolicy="no-referrer" loading="lazy" />;
  }
  return (
    <div className={`${className} ${rounded} grid shrink-0 place-items-center bg-gradient-to-br ${GRADIENTS[hash(name) % GRADIENTS.length]} font-bold text-white/95`} aria-hidden="true">
      <span className="text-[0.9em]">{name.trim().charAt(0).toUpperCase() || "?"}</span>
    </div>
  );
}
