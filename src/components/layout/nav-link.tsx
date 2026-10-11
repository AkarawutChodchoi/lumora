"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function NavLink({ href, icon, label, variant }: { href: string; icon: ReactNode; label: string; variant: "side" | "bottom" }) {
  const path = usePathname();
  const active = path === href || (href !== "/" && path.startsWith(`${href}/`) && !(href === "/characters/new"));
  if (variant === "bottom") {
    return (
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium ${active ? "text-accent" : "text-faint hover:text-fg"}`}
      >
        {icon}
        {label}
      </Link>
    );
  }
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
        active ? "bg-accent-soft text-fg" : "text-muted hover:bg-surface-2 hover:text-fg"
      }`}
    >
      <span className={active ? "text-accent" : ""}>{icon}</span>
      {label}
    </Link>
  );
}
