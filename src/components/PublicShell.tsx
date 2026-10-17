import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

/** Cadre des pages voyageur : logo, contenu centré, pied de page. */
export function PublicShell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <main className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center gap-3 px-4 py-4 sm:px-10">
        <Link to="/" className="flex items-center gap-3 no-underline">
          <span
            aria-hidden="true"
            className="flex size-10 items-center justify-center rounded-xl bg-primary text-xl font-extrabold text-highlight"
          >
            T
          </span>
          <span className="text-xl font-extrabold tracking-tight text-foreground">Tufani</span>
        </Link>
      </header>
      <section
        className={
          wide
            ? "mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-4 pb-12 sm:px-10"
            : "mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-4 pb-12 sm:px-6"
        }
      >
        {children}
      </section>
      <footer className="border-t border-border px-4 py-6 text-center text-xs text-muted-foreground sm:px-10">
        Tufani · billets de bus au Mali · le bon prix, le bon bus, ou remboursé
      </footer>
    </main>
  );
}
