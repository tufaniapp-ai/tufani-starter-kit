import { Link, createFileRoute } from "@tanstack/react-router";

import { Card } from "@/components/pro/ui";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS, can } from "@/domain/roles";
import type { CompanyStatus } from "@/lib/db";
import { STEPS, stepDone, usePro, type SetupStatus, type StepKey } from "@/lib/pro-context";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/pro/")({
  component: Dashboard,
});

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

function detail(key: StepKey, s: SetupStatus | null): string {
  if (!s) return "";
  switch (key) {
    case "gares":
      return s.gares === 0 ? "Aucune gare" : `${s.gares} gare(s)`;
    case "lignes":
      return s.lignes === 0 ? "Aucune ligne" : `${s.lignes} ligne(s)`;
    case "bus":
      return s.bus === 0 ? "Aucun bus" : `${s.bus} bus, ${s.modeles} modèle(s)`;
    case "horaires":
      if (s.horaires === 0) return "Aucun horaire";
      return s.troncons_sans_prix > 0
        ? `${s.horaires} horaire(s) · ${s.troncons_sans_prix} prix à compléter`
        : `${s.horaires} horaire(s), tous les prix renseignés`;
    case "annulation":
      return s.annulation ? "Règle choisie" : "À choisir";
    case "equipe":
      return s.equipe <= 1 ? "Vous seul pour l'instant" : `${s.equipe} personnes`;
    case "versements":
      return s.versements ? "Compte enregistré" : "À renseigner";
  }
}

function Dashboard() {
  const { membership, memberships, status, switchCompany } = usePro();
  const { company, roles } = membership;
  const badge = STATUS[company.status];
  const next = STEPS.find((s) => !stepDone(s.key, status));
  const doneCount = STEPS.filter((s) => stepDone(s.key, status)).length;

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-extrabold tracking-tight">{company.name}</h1>
          <span className={cn("rounded-full px-3 py-1 text-xs font-bold", badge.className)}>
            {badge.label}
          </span>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">{badge.help}</p>
        <p className="text-sm">
          Vous êtes : <strong>{roles.map((r) => ROLE_LABELS[r]).join(", ")}</strong>
          {membership.all_stations ? " · toutes les gares" : ""}
        </p>
        {memberships.length > 1 && (
          <div className="flex flex-wrap gap-3 text-sm">
            <span className="text-muted-foreground">Autres compagnies :</span>
            {memberships
              .filter((m) => m.company_id !== company.id)
              .map((m) => (
                <button
                  key={m.company_id}
                  type="button"
                  onClick={() => switchCompany(m.company_id)}
                  className="font-bold text-primary"
                >
                  {m.company.name}
                </button>
              ))}
          </div>
        )}
      </div>

      {can(roles, "vendre_au_guichet") && (
        <Card title="Vente au guichet">
          <p className="text-sm text-muted-foreground">
            Vendez les départs du jour, imprimez les billets et suivez votre caisse. Le guichet
            continue de vendre si le réseau coupe.
          </p>
          <Button asChild className="h-12 w-fit rounded-xl px-6 font-extrabold">
            <Link to="/guichet">Ouvrir le guichet</Link>
          </Button>
        </Card>
      )}

      {can(roles, "configurer_compagnie") && (
        <Card
          title="Mise en route"
          aside={
            <span className="text-sm text-muted-foreground">
              {doneCount} étape(s) sur {STEPS.length}
            </span>
          }
        >
          <ol className="flex flex-col">
            {STEPS.map((s, i) => {
              const done = stepDone(s.key, status);
              return (
                <li key={s.key} className="flex items-center gap-3 border-t py-3 first:border-t-0">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-extrabold",
                      done
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-muted-foreground",
                    )}
                  >
                    {done ? "✓" : i + 1}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="font-bold">{s.label}</span>
                    <span className="text-xs text-muted-foreground">{detail(s.key, status)}</span>
                  </div>
                  <Link to={s.to} className="py-2 text-sm font-bold text-primary">
                    {done ? "Modifier" : "Ouvrir"}
                  </Link>
                </li>
              );
            })}
          </ol>
          {next ? (
            <Button asChild className="h-12 w-fit rounded-xl px-6 font-extrabold">
              <Link to={next.to}>Continuer : {next.label.toLowerCase()}</Link>
            </Button>
          ) : (
            <p className="rounded-xl bg-accent px-4 py-3 text-sm font-bold text-accent-foreground">
              Mise en route terminée. La vente au guichet arrive dans la prochaine étape du
              développement.
            </p>
          )}
        </Card>
      )}
    </>
  );
}
