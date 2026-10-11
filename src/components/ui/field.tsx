"use client";

import { useId, type ComponentProps, type ReactNode } from "react";

const control =
  "w-full rounded-xl border border-line bg-surface-2 px-3.5 text-fg placeholder:text-faint transition-colors focus:border-accent focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-60 aria-[invalid=true]:border-danger";

interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string;
  counter?: { value: number; max: number };
}

function FieldShell({ id, label, hint, error, counter, children }: FieldProps & { id: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-fg">
          {label}
        </label>
        {counter && (
          <span className={`text-xs tabular-nums ${counter.value > counter.max ? "text-danger" : "text-faint"}`}>
            {counter.value}/{counter.max}
          </span>
        )}
      </div>
      {children}
      {error ? (
        <p id={`${id}-err`} className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function TextField({ label, hint, error, counter, className = "", ...rest }: FieldProps & ComponentProps<"input">) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} counter={counter}>
      <input
        id={id}
        className={`${control} h-11 ${className}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
        {...rest}
      />
    </FieldShell>
  );
}

export function TextArea({ label, hint, error, counter, className = "", ...rest }: FieldProps & ComponentProps<"textarea">) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} counter={counter}>
      <textarea
        id={id}
        className={`${control} min-h-24 resize-y py-2.5 leading-relaxed ${className}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
        {...rest}
      />
    </FieldShell>
  );
}

export function SelectField({
  label,
  hint,
  error,
  options,
  className = "",
  ...rest
}: FieldProps & ComponentProps<"select"> & { options: { value: string; label: string }[] }) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <select id={id} className={`${control} h-11 ${className}`} aria-invalid={error ? true : undefined} {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div>
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {description && <p className="mt-0.5 text-xs text-faint">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${checked ? "bg-accent" : "bg-surface-3"}`}
      >
        <span className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white transition-transform ${checked ? "translate-x-5" : ""}`} />
      </button>
    </div>
  );
}
