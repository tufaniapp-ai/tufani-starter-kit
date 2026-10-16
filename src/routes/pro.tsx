import { Link, createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { MALI_CITIES } from "@/domain/cities";
import { formatLocalPhone } from "@/domain/phone";
import { ROLE_LABELS, can } from "@/domain/roles";
import { nextSlug, slugify } from "@/domain/slug";
import { supabase } from "@/integrations/supabase/client";
import { db, type CompanyStatus, type Membership, type StationRow } from "@/lib/db";

export const Route = createFileRoute("/pro")({
  head: () => ({
    meta: [{ title: "Espace compagnie — Tufani Pro" }, { name: "robots", content: "noindex" }],
  }),
  component: Pro,
});

type Load =
  | { state: "loading" }
  | { state: "anonymous" }
  | { state: "error"; message: string }
  | { state: "ready"; userPhone: string | null; memberships: Membership[] };

const STATUS: Record<CompanyStatus, { label: string; className: string; help: string }> = {
  en_attente: {
    label: "En attente de validation",
    className: "bg-warning text-warning-foreground",
    help: "Vous pouvez déjà tout configurer et vendre au guichet. La vente en ligne s'ouvrira après la vérification de vos documents.",
  },
  validee: {
    label: "Compagnie validée",
    className: "bg-accent text-accent-foreground",
    help: "Vos départs peuvent être vendus en ligne.",
  },
  suspendue: {
    label: "Compagnie suspendue",
    className: "bg-destructive text-destructive-foreground",
    help: "Contactez Tufani pour rétablir votre accès.",
  },
};

function Pro() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [currentId, setCurrentId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
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
      setLoad({ state: "error", message: "Impossible de charger votre espace. Réessayez." });
      return;
    }
    const memberships = (data ?? []) as unknown as Membership[];
    setLoad({
      state: "ready",
      userPhone: auth.user.phone ? `+${auth.user.phone}` : null,
      memberships,
    });
    setCurrentId((id) => id ?? memberships[0]?.company_id ?? null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function signOut() {
    await supabase.auth.signOut();
    setLoad({ state: "anonymous" });
  }

  const userPhone = load.state === "ready" ? load.userPhone : null;
  const current =
    load.state === "ready"
      ? (load.memberships.find((m) => m.company_id === currentId) ?? load.memberships[0])
      : undefined;

  return (
    <Shell userPhone={userPhone} onSignOut={load.state === "ready" ? signOut : undefined}>
      {load.state === "loading" && <p className="text-muted-foreground">Chargement…</p>}

      {load.state === "anonymous" && (
        <div className="flex flex-col gap-4">
          <h1 className="text-3xl font-extrabold tracking-tight">Espace compagnie</h1>
          <p className="text-muted-foreground">
            Connectez-vous avec votre numéro de téléphone pour continuer.
          </p>
          <Button asChild className="h-14 w-fit rounded-2xl px-8 text-base font-extrabold">
            <Link to="/connexion" search={{ suite: "/pro" }}>
              Se connecter
            </Link>
          </Button>
        </div>
      )}

      {load.state === "error" && (
        <p
          role="alert"
          className="rounded-xl bg-warning px-4 py-3 font-semibold text-warning-foreground"
        >
          {load.message}
        </p>
      )}

      {load.state === "ready" && !current && <CreateCompany onCreated={refresh} />}

      {load.state === "ready" && current && (
        <Dashboard
          membership={current}
          others={load.memberships.filter((m) => m.company_id !== current.company_id)}
          onSwitch={setCurrentId}
        />
      )}
    </Shell>
  );
}

function Shell({
  userPhone,
  onSignOut,
  children,
}: {
  userPhone: string | null;
  onSignOut: (() => Promise<void>) | undefined;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-screen flex-col bg-background">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-card px-5 py-4 sm:px-10">
        <Link to="/" className="flex items-center gap-3 text-foreground no-underline">
          <span
            aria-hidden="true"
            className="flex size-9 items-center justify-center rounded-xl bg-primary text-lg font-extrabold text-highlight"
          >
            T
          </span>
          <span className="text-lg font-extrabold">Tufani Pro</span>
        </Link>
        {userPhone && onSignOut && (
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted-foreground">{formatLocalPhone(userPhone)}</span>
            <button
              type="button"
              onClick={() => void onSignOut()}
              className="py-2 font-bold text-primary"
            >
              Se déconnecter
            </button>
          </div>
        )}
      </header>
      <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-5 py-8 sm:px-10">
        {children}
      </section>
    </main>
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
      <div className="flex flex-col gap-2">
        <span className="text-sm font-bold text-primary">Étape 1 de la mise en route</span>
        <h1 className="text-3xl font-extrabold tracking-tight">Créer votre compagnie</h1>
        <p className="leading-relaxed text-muted-foreground">
          Vous en deviendrez le gérant. Vous pourrez ensuite ajouter vos gares et inviter votre
          équipe.
        </p>
      </div>
      <Field label="Nom affiché aux voyageurs" id="company">
        <input
          id="company"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          placeholder="Ex. Djoliba Trans"
          maxLength={80}
          className="h-14 rounded-2xl border-2 border-input bg-card px-4 text-lg font-bold outline-none focus:border-primary"
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
          className="h-14 rounded-2xl border-2 border-input bg-card px-4 text-lg font-bold outline-none focus:border-primary"
        />
      </Field>
      {error && (
        <p
          role="alert"
          className="rounded-xl bg-warning px-4 py-3 text-sm font-semibold text-warning-foreground"
        >
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy} className="h-14 rounded-2xl text-base font-extrabold">
        {busy ? "Création…" : "Créer la compagnie"}
      </Button>
    </form>
  );
}

function Dashboard({
  membership,
  others,
  onSwitch,
}: {
  membership: Membership;
  others: Membership[];
  onSwitch: (companyId: string) => void;
}) {
  const { company, roles } = membership;
  const status = STATUS[company.status];
  const canConfigure = can(roles, "configurer_compagnie");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-extrabold tracking-tight">{company.name}</h1>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${status.className}`}>
            {status.label}
          </span>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">{status.help}</p>
        <p className="text-sm">
          Vous êtes : <strong>{roles.map((r) => ROLE_LABELS[r]).join(", ")}</strong>
          {membership.all_stations ? " · toutes les gares" : ""}
        </p>
        {others.length > 0 && (
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="text-muted-foreground">Autres compagnies :</span>
            {others.map((m) => (
              <button
                key={m.company_id}
                type="button"
                onClick={() => onSwitch(m.company_id)}
                className="font-bold text-primary"
              >
                {m.company.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <Stations companyId={company.id} canConfigure={canConfigure} />

      <section className="flex flex-col gap-2 rounded-2xl bg-card p-5">
        <h2 className="text-lg font-extrabold">Suite de la mise en route</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Lignes et arrêts, bus, horaires et tarifs, règles d'annulation, équipe et versements
          arrivent dans les prochaines étapes.
        </p>
      </section>
    </div>
  );
}

function Stations({ companyId, canConfigure }: { companyId: string; canConfigure: boolean }) {
  const [stations, setStations] = useState<StationRow[] | null>(null);
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStations = useCallback(async () => {
    const { data } = await db
      .from("stations")
      .select("id, company_id, name, city, active")
      .eq("company_id", companyId)
      .order("city")
      .order("name");
    setStations((data ?? []) as StationRow[]);
  }, [companyId]);

  useEffect(() => {
    void loadStations();
  }, [loadStations]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (name.trim().length < 2 || city.trim().length < 2) {
      setError("Indiquez le nom de la gare et sa ville.");
      return;
    }
    setBusy(true);
    try {
      const { error: insertError } = await db
        .from("stations")
        .insert({ company_id: companyId, name: name.trim(), city: city.trim() });
      if (insertError) {
        setError(
          insertError.code === "23505"
            ? "Cette gare existe déjà dans cette ville."
            : "La gare n'a pas pu être ajoutée. Réessayez.",
        );
        return;
      }
      setName("");
      setCity("");
      await loadStations();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl bg-card p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-extrabold">Vos gares</h2>
        {stations && (
          <span className="text-sm text-muted-foreground">{stations.length} gare(s)</span>
        )}
      </div>

      {stations === null && <p className="text-sm text-muted-foreground">Chargement…</p>}
      {stations?.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Aucune gare pour l'instant. Ajoutez votre première gare.
        </p>
      )}
      {stations && stations.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {stations.map((s) => (
            <li
              key={s.id}
              className="rounded-full bg-accent px-4 py-2 text-sm font-bold text-accent-foreground"
            >
              {s.name} · {s.city}
            </li>
          ))}
        </ul>
      )}

      {canConfigure && (
        <form onSubmit={add} className="flex flex-col gap-3 border-t pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nom de la gare" id="station-name">
              <input
                id="station-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex. Sogoniko"
                maxLength={80}
                className="h-12 rounded-xl border-2 border-input bg-background px-3 font-semibold outline-none focus:border-primary"
              />
            </Field>
            <Field label="Ville" id="station-city">
              <input
                id="station-city"
                list="mali-cities"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Ex. Bamako"
                maxLength={60}
                className="h-12 rounded-xl border-2 border-input bg-background px-3 font-semibold outline-none focus:border-primary"
              />
              <datalist id="mali-cities">
                {MALI_CITIES.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
          </div>
          {error && (
            <p
              role="alert"
              className="rounded-xl bg-warning px-4 py-3 text-sm font-semibold text-warning-foreground"
            >
              {error}
            </p>
          )}
          <Button
            type="submit"
            disabled={busy}
            className="h-12 w-fit rounded-xl px-6 font-extrabold"
          >
            {busy ? "Ajout…" : "Ajouter la gare"}
          </Button>
        </form>
      )}
    </section>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-semibold text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}
