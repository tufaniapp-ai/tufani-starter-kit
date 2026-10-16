import { Link, createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { Card, Choice, Field, Notice, PageTitle, dbMessage, inputClass } from "@/components/pro/ui";
import { Button } from "@/components/ui/button";
import { formatFcfa } from "@/domain/money";
import { can } from "@/domain/roles";
import {
  WEEKDAYS,
  departuresOver,
  normalizeTime,
  sellableSegments,
  suggestFare,
} from "@/domain/setup";
import { db } from "@/lib/db";
import { usePro } from "@/lib/pro-context";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/pro/horaires")({
  component: Horaires,
});

type Stop = { position: number; minutes: number; station: { city: string; name: string } };
type RouteRow = { id: string; name: string; sell_segments: boolean; route_stops: Stop[] };
type ModelRow = { id: string; name: string; capacity: number };
type ScheduleRow = {
  id: string;
  route_id: string;
  departure_time: string;
  weekdays: number[];
  model_id: string;
};
type FareRow = { route_id: string; from_pos: number; to_pos: number; price: number };

function Horaires() {
  const { membership, refreshStatus } = usePro();
  const companyId = membership.company_id;
  const canEdit = can(membership.roles, "gerer_tarifs");
  const [routes, setRoutes] = useState<RouteRow[] | null>(null);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [fares, setFares] = useState<FareRow[]>([]);
  const [routeId, setRouteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [r, m, s] = await Promise.all([
      db
        .from("routes")
        .select(
          "id, name, sell_segments, route_stops(position, minutes, station:stations(city, name))",
        )
        .eq("company_id", companyId)
        .eq("active", true)
        .order("created_at"),
      db
        .from("bus_models")
        .select("id, name, capacity")
        .eq("company_id", companyId)
        .order("created_at"),
      db
        .from("schedules")
        .select("id, route_id, departure_time, weekdays, model_id")
        .eq("company_id", companyId)
        .eq("active", true)
        .order("departure_time"),
    ]);
    const rows = ((r.data ?? []) as unknown as RouteRow[]).map((row) => ({
      ...row,
      route_stops: [...row.route_stops].sort((a, b) => a.position - b.position),
    }));
    setRoutes(rows);
    setModels((m.data ?? []) as ModelRow[]);
    setSchedules((s.data ?? []) as ScheduleRow[]);
    const ids = rows.map((x) => x.id);
    if (ids.length > 0) {
      const f = await db
        .from("fares")
        .select("route_id, from_pos, to_pos, price")
        .in("route_id", ids);
      setFares((f.data ?? []) as FareRow[]);
    }
    setRouteId((id) => id ?? rows[0]?.id ?? null);
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const reload = () => Promise.all([load(), refreshStatus()]).then(() => undefined);
  const route = routes?.find((r) => r.id === routeId);
  const total60 = departuresOver(schedules, new Date());

  if (routes && routes.length === 0) {
    return (
      <>
        <PageTitle step="Étape 4" title="Horaires et tarifs" />
        <Notice tone="info">
          Créez d'abord une ligne.{" "}
          <Link to="/pro/lignes" className="font-bold text-primary">
            Aller aux lignes
          </Link>
        </Notice>
      </>
    );
  }

  return (
    <>
      <PageTitle step="Étape 4" title="Horaires et tarifs">
        Décrivez votre semaine type une seule fois : les départs seront créés automatiquement.
        Ensuite, vous ne gérez que les exceptions.
      </PageTitle>

      {routes && (
        <div role="tablist" aria-label="Ligne" className="flex flex-wrap gap-2">
          {routes.map((r) => (
            <Choice key={r.id} selected={r.id === routeId} onClick={() => setRouteId(r.id)}>
              {r.name}
            </Choice>
          ))}
        </div>
      )}

      {schedules.length > 0 && (
        <Notice tone="success">
          Votre semaine type crée {total60} départ(s) sur les 60 prochains jours, toutes lignes
          confondues.
        </Notice>
      )}

      {route && (
        <>
          <ScheduleCard
            companyId={companyId}
            route={route}
            models={models}
            schedules={schedules.filter((s) => s.route_id === route.id)}
            canEdit={canEdit}
            onChange={reload}
          />
          <FaresCard
            route={route}
            fares={fares.filter((f) => f.route_id === route.id)}
            canEdit={canEdit}
            onSaved={reload}
          />
        </>
      )}
    </>
  );
}

function ScheduleCard({
  companyId,
  route,
  models,
  schedules,
  canEdit,
  onChange,
}: {
  companyId: string;
  route: RouteRow;
  models: ModelRow[];
  schedules: ScheduleRow[];
  canEdit: boolean;
  onChange: () => Promise<void>;
}) {
  const [time, setTime] = useState("");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
  const [modelId, setModelId] = useState(models[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setModelId((id) => id || models[0]?.id || "");
  }, [models]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const t = normalizeTime(time);
    if (!t) {
      setError("Heure illisible. Écrivez par exemple « 06:00 » ou « 7h30 ».");
      return;
    }
    if (days.length === 0) {
      setError("Choisissez au moins un jour.");
      return;
    }
    if (!modelId) {
      setError("Ajoutez d'abord un modèle de bus.");
      return;
    }
    setBusy(true);
    try {
      const { error: insertError } = await db.from("schedules").insert({
        company_id: companyId,
        route_id: route.id,
        departure_time: t,
        weekdays: [...days].sort(),
        model_id: modelId,
      });
      if (insertError) {
        setError(
          insertError.code === "23505"
            ? `Un départ à ${t} existe déjà sur cette ligne.`
            : dbMessage(insertError, "L'horaire n'a pas pu être ajouté."),
        );
        return;
      }
      setTime("");
      await onChange();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const { error: deleteError } = await db.from("schedules").delete().eq("id", id);
    if (deleteError) setError(dbMessage(deleteError, "L'horaire n'a pas pu être retiré."));
    await onChange();
  }

  const first = route.route_stops[0]?.station.city ?? "";

  return (
    <Card
      title={`Départs de ${first}`}
      aside={
        <span className="text-sm text-muted-foreground">
          {departuresOver(schedules, new Date())} départs sur 60 jours
        </span>
      }
    >
      {schedules.length === 0 && (
        <p className="text-sm text-muted-foreground">Aucun départ pour cette ligne.</p>
      )}
      {schedules.length > 0 && (
        <ul className="flex flex-col">
          {schedules.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t py-2 first:border-t-0"
            >
              <span className="w-16 text-lg font-extrabold">{s.departure_time.slice(0, 5)}</span>
              <span className="text-sm">
                {s.weekdays.length === 7
                  ? "Tous les jours"
                  : WEEKDAYS.filter((d) => s.weekdays.includes(d.n))
                      .map((d) => d.long.slice(0, 3))
                      .join(", ")}
              </span>
              <span className="text-sm text-muted-foreground">
                {models.find((m) => m.id === s.model_id)?.name}
              </span>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => void remove(s.id)}
                  className="ml-auto py-2 text-sm font-bold text-primary"
                >
                  Retirer
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && models.length === 0 && (
        <Notice tone="info">
          Ajoutez un modèle de bus pour programmer des départs.{" "}
          <Link to="/pro/bus" className="font-bold text-primary">
            Aller aux bus
          </Link>
        </Notice>
      )}

      {canEdit && models.length > 0 && (
        <form onSubmit={add} className="flex flex-col gap-3 border-t pt-4">
          <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
            <Field label="Heure de départ" id="dep-time">
              <input
                id="dep-time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                placeholder="06:00"
                className={inputClass}
              />
            </Field>
            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold text-muted-foreground">Jours</span>
              <div role="group" aria-label="Jours de circulation" className="flex flex-wrap gap-1">
                {WEEKDAYS.map((d) => {
                  const on = days.includes(d.n);
                  return (
                    <button
                      key={d.n}
                      type="button"
                      aria-pressed={on}
                      aria-label={d.long}
                      onClick={() =>
                        setDays((list) => (on ? list.filter((x) => x !== d.n) : [...list, d.n]))
                      }
                      className={cn(
                        "size-11 rounded-xl text-sm font-extrabold",
                        on
                          ? "bg-primary text-primary-foreground"
                          : "border-2 border-input bg-card text-muted-foreground",
                      )}
                    >
                      {d.short}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          {models.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {models.map((m) => (
                <Choice key={m.id} selected={modelId === m.id} onClick={() => setModelId(m.id)}>
                  {m.name}
                </Choice>
              ))}
            </div>
          )}
          {error && <Notice>{error}</Notice>}
          <Button
            type="submit"
            disabled={busy}
            className="h-11 w-fit rounded-xl px-5 font-extrabold"
          >
            {busy ? "Ajout…" : "Ajouter ce départ"}
          </Button>
        </form>
      )}
    </Card>
  );
}

function FaresCard({
  route,
  fares,
  canEdit,
  onSaved,
}: {
  route: RouteRow;
  fares: FareRow[];
  canEdit: boolean;
  onSaved: () => Promise<void>;
}) {
  const pairs = useMemo(
    () => sellableSegments(route.route_stops.length, route.sell_segments),
    [route],
  );
  const key = (f: number, t: number) => `${f}-${t}`;
  const initial = useMemo(
    () => Object.fromEntries(fares.map((f) => [key(f.from_pos, f.to_pos), String(f.price)])),
    [fares],
  );
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => setValues(initial), [initial]);

  const city = (p: number) => route.route_stops.find((s) => s.position === p)?.station.city ?? "?";
  const parsed = (v: string | undefined) => {
    const n = Number((v ?? "").replace(/\s/g, ""));
    return Number.isInteger(n) && n >= 100 ? n : null;
  };
  const missing = pairs.filter((p) => parsed(values[key(p.from, p.to)]) === null).length;

  function propose() {
    const known = pairs
      .map((p) => ({ ...p, price: parsed(values[key(p.from, p.to)]) }))
      .filter((p): p is { from: number; to: number; price: number } => p.price !== null);
    if (known.length === 0) {
      setError(
        "Indiquez au moins un prix (par exemple le trajet complet) pour proposer les autres.",
      );
      return;
    }
    setError(null);
    const next = { ...values };
    for (const p of pairs) {
      if (parsed(next[key(p.from, p.to)]) === null) {
        const s = suggestFare(route.route_stops, known, p);
        if (s !== null) next[key(p.from, p.to)] = String(s);
      }
    }
    setValues(next);
  }

  async function save() {
    setError(null);
    setSaved(false);
    const rows = pairs
      .map((p) => ({
        route_id: route.id,
        from_pos: p.from,
        to_pos: p.to,
        price: parsed(values[key(p.from, p.to)]),
      }))
      .filter((r) => r.price !== null);
    const invalid = pairs.filter((p) => {
      const v = values[key(p.from, p.to)];
      return v !== undefined && v.trim() !== "" && parsed(v) === null;
    });
    if (invalid.length > 0) {
      setError("Certains prix sont illisibles ou inférieurs à 100 FCFA.");
      return;
    }
    setBusy(true);
    try {
      const { error: upsertError } = await db
        .from("fares")
        .upsert(rows, { onConflict: "route_id,from_pos,to_pos" });
      if (upsertError) {
        setError(dbMessage(upsertError, "Les prix n'ont pas pu être enregistrés."));
        return;
      }
      setSaved(true);
      await onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Prix par trajet (FCFA, adulte)"
      aside={
        <span
          className={cn(
            "text-sm",
            missing > 0 ? "font-bold text-warning-foreground" : "text-muted-foreground",
          )}
        >
          {missing > 0 ? `${missing} prix à compléter` : "Tous les prix renseignés"}
        </span>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[22rem] border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="py-2 pr-3 font-semibold">Trajet</th>
              <th className="w-40 py-2 font-semibold">Prix</th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((p) => {
              const k = key(p.from, p.to);
              const empty = parsed(values[k]) === null;
              return (
                <tr key={k} className="border-t">
                  <td className="py-2 pr-3 font-bold">
                    {city(p.from)} → {city(p.to)}
                  </td>
                  <td className="py-2">
                    <input
                      aria-label={`Prix ${city(p.from)} → ${city(p.to)}`}
                      inputMode="numeric"
                      disabled={!canEdit}
                      value={values[k] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
                      placeholder="À compléter"
                      className={cn(
                        inputClass,
                        "h-10",
                        empty && "border-dashed border-warning-foreground/60 bg-warning/40",
                      )}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <>
          <p className="text-xs text-muted-foreground">
            « Proposer » calcule les prix manquants à partir du trajet le plus long déjà renseigné,
            en proportion du temps de parcours. Vous ajustez ensuite. Exemple :{" "}
            {formatFcfa(12500, "F")} pour le trajet complet.
          </p>
          {error && <Notice>{error}</Notice>}
          {saved && <Notice tone="success">Prix enregistrés.</Notice>}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={propose}
              className="h-11 rounded-xl px-5 font-bold"
            >
              Proposer les prix manquants
            </Button>
            <Button
              type="button"
              onClick={() => void save()}
              disabled={busy}
              className="h-11 rounded-xl px-5 font-extrabold"
            >
              {busy ? "Enregistrement…" : "Enregistrer les prix"}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
