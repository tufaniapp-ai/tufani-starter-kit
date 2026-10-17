import { Link, Outlet, createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";

import { Field, Notice, PageTitle, inputClass } from "@/components/pro/ui";
import { Button } from "@/components/ui/button";
import { formatLocalPhone } from "@/domain/phone";
import { can } from "@/domain/roles";
import { nextSlug, slugify } from "@/domain/slug";
import { supabase } from "@/integrations/supabase/client";
import { db, type Membership } from "@/lib/db";
import { ProContext, STEPS, stepDone, type SetupStatus } from "@/lib/pro-context";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/pro")({
  head: () => ({
    meta: [{ title: "Espace compagnie — Tufani Pro" }, { name: "robots", content: "noindex" }],
  }),
  component: ProLayout,
});

const COMPANY_KEY = "tufani.pro.compagnie";

type Load =
  | { state: "loading" }
  | { state: "anonymous" }
  | { state: "error" }
  | { state: "ready"; userPhone: string | null; memberships: Membership[] };

function ProLayout() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [status, setStatus] = useState<SetupStatus | null>(null);

  const loadMemberships = useCallback(async () => {
    const { data: auth, error: authError } = await supabase.auth.getUser();
    // Sans réseau, getUser échoue : on ne confond pas « hors ligne » avec « déconnecté ».
    if (authError && authError.name !== "AuthSessionMissingError") {
      setLoad({ state: "error" });
      return;
    }
    if (!auth.user) {
      setLoad({ state: "anonymous" });
      return;
    }
    const { data, error } = await db
      .from("members")
      .select(
        "id, company_id, phone, full_name, roles, all_stations, active, company:companies(id, name, slug, status, service_phone, created_at)",
      )
      .eq("user_id", auth.user.id)
      .eq("active", true)
      .order("invited_at");
    if (error) {
      setLoad({ state: "error" });
      return;
    }
    const memberships = (data ?? []) as unknown as Membership[];
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(COMPANY_KEY);
    } catch {
      saved = null;
    }
    setCurrentId((id) => id ?? memberships.find((m) => m.company_id === saved)?.company_id ?? null);
    setLoad({
      state: "ready",
      userPhone: auth.user.phone ? `+${auth.user.phone}` : null,
      memberships,
    });
  }, []);

  useEffect(() => {
    void loadMemberships();
  }, [loadMemberships]);

  const membership =
    load.state === "ready"
      ? (load.memberships.find((m) => m.company_id === currentId) ?? load.memberships[0])
      : undefined;
  const companyId = membership?.company_id;

  const refreshStatus = useCallback(async () => {
    if (!companyId) return;
    const { data } = await db.rpc("setup_status", { p_company: companyId });
    setStatus((data as SetupStatus | null) ?? null);
  }, [companyId]);

  useEffect(() => {
    setStatus(null);
    void refreshStatus();
  }, [refreshStatus]);

  const switchCompany = useCallback((id: string) => {
    setCurrentId(id);
    try {
      localStorage.setItem(COMPANY_KEY, id);
    } catch {
      /* stockage indisponible : le choix vaut pour cette visite */
    }
  }, []);

  const context = useMemo(
    () =>
      membership && load.state === "ready"
        ? { membership, memberships: load.memberships, status, refreshStatus, switchCompany }
        : null,
    [membership, load, status, refreshStatus, switchCompany],
  );

  async function signOut() {
    await supabase.auth.signOut();
    setLoad({ state: "anonymous" });
  }

  return (
    <main className="flex min-h-screen flex-col bg-background">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-card px-5 py-4 sm:px-8">
        <Link to="/pro" className="flex items-center gap-3 text-foreground no-underline">
          <span
            aria-hidden="true"
            className="flex size-9 items-center justify-center rounded-xl bg-primary text-lg font-extrabold text-highlight"
          >
            T
          </span>
          <span className="text-lg font-extrabold">Tufani Pro</span>
          {membership && (
            <span className="hidden text-sm text-muted-foreground sm:inline">
              · {membership.company.name}
            </span>
          )}
        </Link>
        {load.state === "ready" && (
          <div className="flex items-center gap-4 text-sm">
            {load.userPhone && (
              <span className="text-muted-foreground">{formatLocalPhone(load.userPhone)}</span>
            )}
            <button
              type="button"
              onClick={() => void signOut()}
              className="py-2 font-bold text-primary"
            >
              Se déconnecter
            </button>
          </div>
        )}
      </header>

      {load.state === "loading" && <Centered>Chargement…</Centered>}

      {load.state === "anonymous" && (
        <Centered>
          <PageTitle title="Espace compagnie">
            Connectez-vous avec votre numéro de téléphone pour continuer.
          </PageTitle>
          <Button asChild className="h-14 w-fit rounded-2xl px-8 text-base font-extrabold">
            <Link to="/connexion" search={{ suite: "/pro" }}>
              Se connecter
            </Link>
          </Button>
        </Centered>
      )}

      {load.state === "error" && (
        <Centered>
          <Notice>
            Impossible de charger votre espace. Vérifiez votre connexion internet, puis réessayez.
          </Notice>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setLoad({ state: "loading" });
              void loadMemberships();
            }}
            className="h-12 w-fit rounded-xl px-6 font-bold"
          >
            Réessayer
          </Button>
        </Centered>
      )}

      {load.state === "ready" && !membership && (
        <Centered>
          <CreateCompany onCreated={loadMemberships} />
        </Centered>
      )}

      {context && (
        <ProContext.Provider value={context}>
          <div className="flex flex-1 flex-wrap">
            <nav
              aria-label="Étapes de la mise en route"
              className="flex w-full gap-1 overflow-x-auto border-b px-3 py-2 md:w-60 md:flex-col md:overflow-visible md:border-r md:border-b-0 md:px-4 md:py-6"
            >
              <NavItem to="/pro" exact label="Tableau de bord" />
              {can(context.membership.roles, "vendre_au_guichet") && (
                <NavItem to="/guichet" label="Guichet" />
              )}
              {can(context.membership.roles, "configurer_compagnie") &&
                STEPS.map((s, i) => (
                  <NavItem
                    key={s.key}
                    to={s.to}
                    label={s.label}
                    number={i + 1}
                    done={stepDone(s.key, status)}
                  />
                ))}
            </nav>
            <section className="flex min-w-0 flex-1 flex-col gap-6 px-5 py-8 sm:px-8 lg:max-w-4xl">
              <Outlet />
            </section>
          </div>
        </ProContext.Provider>
      )}
    </main>
  );
}

function NavItem({
  to,
  label,
  number,
  done,
  exact,
}: {
  to: string;
  label: string;
  number?: number;
  done?: boolean;
  exact?: boolean;
}) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: Boolean(exact) }}
      className="flex min-h-11 shrink-0 items-center gap-3 rounded-xl px-3 text-sm font-semibold whitespace-nowrap text-muted-foreground no-underline"
      activeProps={{ className: "bg-card text-foreground shadow-sm font-extrabold" }}
    >
      {number !== undefined && (
        <span
          aria-hidden="true"
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-extrabold",
            done ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground",
          )}
        >
          {done ? "✓" : number}
        </span>
      )}
      <span>{label}</span>
      {done && <span className="sr-only">(fait)</span>}
    </Link>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <section className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-5 py-10">
      {children}
    </section>
  );
}

function CreateCompany({ onCreated }: { onCreated: () => Promise<void> }) {
  const [companyName, setCompanyName] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const base = slugify(companyName);
    if (companyName.trim().length < 2 || !base) {
      setError("Indiquez le nom de votre compagnie.");
      return;
    }
    if (fullName.trim().length < 2) {
      setError("Indiquez votre nom complet.");
      return;
    }
    setBusy(true);
    try {
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const { error: rpcError } = await db.rpc("create_company", {
          p_name: companyName.trim(),
          p_slug: nextSlug(base, attempt),
          p_full_name: fullName.trim(),
        });
        if (!rpcError) {
          await onCreated();
          return;
        }
        if (rpcError.code !== "23505") {
          setError(
            rpcError.message.includes("Numéro malien")
              ? "Votre compte doit être lié à un numéro malien vérifié."
              : "La création n'a pas abouti. Réessayez dans un instant.",
          );
          return;
        }
      }
      setError("Ce nom est déjà très utilisé. Ajoutez un mot pour le distinguer.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <PageTitle step="Mise en route" title="Créer votre compagnie">
        Vous en deviendrez le gérant. Vous ajouterez ensuite vos gares, lignes, bus et horaires,
        puis votre équipe.
      </PageTitle>
      <Field label="Nom affiché aux voyageurs" id="company">
        <input
          id="company"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          placeholder="Ex. Djoliba Trans"
          maxLength={80}
          className={cn(inputClass, "h-14 text-lg")}
        />
      </Field>
      <Field label="Votre nom complet" id="fullname">
        <input
          id="fullname"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Ex. Mamadou Diallo"
          maxLength={80}
          autoComplete="name"
          className={cn(inputClass, "h-14 text-lg")}
        />
      </Field>
      {error && <Notice>{error}</Notice>}
      <Button type="submit" disabled={busy} className="h-14 rounded-2xl text-base font-extrabold">
        {busy ? "Création…" : "Créer la compagnie"}
      </Button>
    </form>
  );
}
