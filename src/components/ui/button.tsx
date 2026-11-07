import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { Spinner } from "./spinner";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

// Alinmanga button shapes: 10px radius, bold amber (accent) primary with dark text.
const base =
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-[10px] font-semibold transition-[opacity,background-color,color] disabled:cursor-not-allowed disabled:opacity-40 select-none whitespace-nowrap";

const variants: Record<Variant, string> = {
  primary: "bg-accent font-bold text-on-accent hover:opacity-90",
  secondary: "border border-line3 bg-transparent text-ink hover:bg-field",
  ghost: "text-sub hover:bg-field hover:text-ink",
  danger: "border border-danger/40 bg-danger-bg text-danger-soft hover:opacity-90",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-3.5 text-sm",
  md: "h-11 px-5 text-sm",
  lg: "h-12 px-6 text-base",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra = "") {
  return `${base} ${variants[variant]} ${sizes[size]} ${extra}`;
}

export function Button({
  variant = "primary",
  size = "md",
  loading,
  className = "",
  children,
  disabled,
  ...rest
}: ComponentProps<"button"> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <button className={buttonClass(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  className = "",
  children,
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)}>
      {children}
    </Link>
  );
}
