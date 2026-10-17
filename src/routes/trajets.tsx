import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Notice } from "@/components/pro/ui";
import { PublicShell } from "@/components/PublicShell";
import { SearchForm } from "@/components/SearchForm";
import { displayedPrice, isSearchableDay, maliTime, travelTime } from "@/domain/booking";
import { dayLabel, isoDay } from "@/domain/guichet";
import { formatFcfa } from "@/domain/money";
import { db } from "@/lib/db";

type Search = { de: string; a: string; date: string };

export const Route = createFileRoute("/trajets")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    de: typeof s["de"] === "string" ? s["de"].slice(0, 60) : "",
    a: typeof s["a"] === "string" ? s["a"].slice(0, 60) : "",
    date: typeof s["date"] === "string" ? s["date"] : "",
  }),
  head: () => ({
    meta: [{ title: "Départs — Tufani" }, { name: "robots", content: "noindex" }],
  }),
  component: Trajets,
});

export type Trip = {
  departure_id: string;
  company_name: string;
  route_name: string;
  from_pos: number;
  to_pos: number;
  from_station: string;
  to_station: string;
  from_city: string;
  to_city: string;
  leaves_at: string;
  arrives_at: string;
  price: number;
  seats_left: number;
  capacity: number;
  model_name: string;
};

function Trajets() {
  const { de, a, date } = Route.useSearch();
  const day = isSearchableDay(date, isoDay(0)) ? date : isoDay(0);
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    setTrips(null);
    setError(false);
    if (!de || !a) return setTrips([]);
    void db
      .rpc("search_trips", { p_from: de, p_to: a, p_date: day })
      .then(({ data, error: e }) => {
        if (e) setError(true);
        else setTrips((data ?? []) as Trip[]);
      })
      .then(undefined, () => setError(true));
  }, [de, a, day]);

  return (
    <PublicShell>
      <h1 className="text-2xl font-extrabold">
        {de && a ? `${de} → ${a}` : "Rechercher un trajet"}
        <span className="block text-base font-semibold text-muted-foreground">{dayLabel(day)}</span>
      </h1>

      <details className="rounded-2xl border border-border bg-card">
        <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-primary">
          Modifier la recherche
        </summary>
        <div className="p-2">
          <SearchForm initial={{ de, a, date: day }} />
        </div>
      </details>

      {error && <Notice>Impossible de charger les départs. Vérifiez votre connexion.</Notice>}
      {!error && trips === null && <p className="text-muted-foreground">Recherche des départs…</p>}
      {trips?.length === 0 && !error && (
        <Notice tone="info">
          Aucun départ en vente en ligne ce jour-là. Essayez un autre jour : la vente en ligne ferme
          30 minutes avant le départ.
        </Notice>
      )}

      <ul className="flex flex-col gap-3">
        {trips?.map((t) => {
          const full = t.seats_left <= 0;
          return (
            <li key={`${t.departure_id}-${t.from_pos}-${t.to_pos}`}>
              <article className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-primary">{t.company_name}</span>
                    <span className="text-2xl font-extrabold">
                      {maliTime(t.leaves_at)}
                      <span className="mx-2 text-base font-semibold text-muted-foreground">→</span>
                      {maliTime(t.arrives_at)}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {t.from_station} → {t.to_station} · {travelTime(t.leaves_at, t.arrives_at)}
                    </span>
                  </div>
                  <span className="text-right">
                    <span className="block text-xl font-extrabold">
                      {formatFcfa(displayedPrice(t.price), "F")}
                    </span>
                    <span className="text-xs text-muted-foreground">par place, frais inclus</span>
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span
                    className={
                      t.seats_left <= 5
                        ? "text-sm font-bold text-destructive"
                        : "text-sm text-muted-foreground"
                    }
                  >
                    {full
                      ? "Complet"
                      : `${t.seats_left} place${t.seats_left > 1 ? "s" : ""} libre${t.seats_left > 1 ? "s" : ""} · ${t.model_name}`}
                  </span>
                  {!full && (
                    <Link
                      to="/reserver/$departureId"
                      params={{ departureId: t.departure_id }}
                      search={{ de: t.from_pos, a: t.to_pos }}
                      className="rounded-xl bg-primary px-5 py-3 text-sm font-extrabold text-primary-foreground no-underline"
                    >
                      Choisir
                    </Link>
                  )}
                </div>
              </article>
            </li>
          );
        })}
      </ul>
    </PublicShell>
  );
}
