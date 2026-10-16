import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function PageTitle({
  step,
  title,
  children,
}: {
  step?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      {step && <span className="text-sm font-bold text-primary">{step}</span>}
      <h1 className="text-3xl font-extrabold tracking-tight">{title}</h1>
      {children && <p className="max-w-2xl leading-relaxed text-muted-foreground">{children}</p>}
    </div>
  );
}

export function Card({
  title,
  aside,
  children,
  className,
}: {
  title?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-4 rounded-2xl bg-card p-5", className)}>
      {(title || aside) && (
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          {title && <h2 className="text-lg font-extrabold">{title}</h2>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({
  label,
  id,
  hint,
  children,
}: {
  label: string;
  id: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-semibold text-muted-foreground">
        {label}
      </label>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

export const inputClass =
  "h-12 w-full rounded-xl border-2 border-input bg-background px-3 font-semibold outline-none focus:border-primary";

export function Notice({
  tone = "warning",
  children,
}: {
  tone?: "warning" | "info" | "success";
  children: ReactNode;
}) {
  const tones = {
    warning: "bg-warning text-warning-foreground",
    info: "bg-secondary text-muted-foreground",
    success: "bg-accent text-accent-foreground",
  };
  return (
    <p
      role={tone === "warning" ? "alert" : "status"}
      className={cn("rounded-xl px-4 py-3 text-sm font-semibold", tones[tone])}
    >
      {children}
    </p>
  );
}

export function Choice({
  selected,
  onClick,
  children,
  className,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "min-h-11 rounded-xl px-4 text-sm font-bold transition-colors",
        selected
          ? "border-2 border-primary bg-accent text-accent-foreground"
          : "border-2 border-input bg-card text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Message d'erreur lisible à partir d'une erreur Postgres levée par nos fonctions. */
export function dbMessage(error: { code?: string; message: string }, fallback: string): string {
  if (error.code === "23505") return "Cet élément existe déjà.";
  if (error.code === "P0001" && error.message) return error.message;
  return fallback;
}
