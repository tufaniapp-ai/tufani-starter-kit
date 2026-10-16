import { Link, createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { Card, Choice, Notice, PageTitle, dbMessage, inputClass } from "@/components/pro/ui";
import { Button } from "@/components/ui/button";
import { can } from "@/domain/roles";
import { formatDuration, parseDuration, sellableSegments } from "@/domain/setup";
import { db, type StationRow } from "@/lib/db";
import { usePro } from "@/lib/pro-context";

export const Route = createFileRoute("/pro/lignes")({
  component: Lignes,
});

type RouteRow = {
  id: string;
  name: string;
  sell_segments: boolean;
  return_of: string | null;
  route_stops: { position: number; minutes: number; station: { name: string; city: string } }[];
};

type DraftStop = { stationId: string; duration: string };

function Lignes() {
  const { membership, refreshStatus } = usePro();
  const companyId = membership.company_id;
  const canEdit = can(membership.roles, "configurer_compagnie");
  const [routes, setRoutes] = useState<RouteRow[] | null>(null);
  const [stations, setStations] = useState<StationRow[]>([]);

  const load = useCallback(async () => {
    const [r, s] = await Promise.all([
      db
        .from("routes")
        .select(
          "id, name, sell_segments, return_of, route_stops(position, minutes, station:stations(name, city))",
        )
        .eq("company_id", companyId)
        .eq("active", true)
        .order("created_at"),
      db
        .from("stations")
        .select("id, company_id, name, city, active")
        .eq("company_id", companyId)
        .eq("active", true)
        .order("city"),
    ]);
    const rows = ((r.data ?? []) as unknown as RouteRow[]).map((row) => ({
      ...row,
      route_stops: [...row.route_stops].sort((a, b) => a.position - b.position),
    }));
    setRoutes(rows);
    setStations((s.data ?? []) as StationRow[]);
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PageTitle step="Étape 2" title="Lignes et arrêts">
        Une ligne relie un départ à une arrivée, avec ses arrêts. En vendant les tronçons, le siège
        libéré à un arrêt est revendu pour la suite du trajet.
      </PageTitle>

      <Card
        title="Vos lignes"
        aside={
          routes && <span className="text-sm text-muted-foreground">{routes.length} ligne(s)</span>
        }
      >
        {routes === null && <p className="text-sm text-muted-foreground">Chargement…</p>}
        {routes?.length === 0 && (
          <p className="text-sm text-muted-foreground">Aucune ligne pour l'instant.</p>
        )}
        {routes?.map((r) => {
          const last = r.route_stops.at(-1);
          const pairs = sellableSegments(r.route_stops.length, r.sell_segments).length;
          return (
            <div
              key={r.id}
              className="flex flex-col gap-2 border-t pt-3 first:border-t-0 first:pt-0"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-extrabold">{r.name}</span>
                <span className="text-xs text-muted-foreground">
                  {last && last.minutes > 0 ? `${formatDuration(last.minutes)} · ` : ""}
                  {pairs} trajet(s) vendable(s){r.return_of ? " · ligne retour" : ""}
                </span>
              </div>
              <ol className="flex flex-wrap items-center gap-1 text-sm">
                {r.route_stops.map((s, i) => (
                  <li key={s.position} className="flex items-center gap-1">
                    {i > 0 && (
                      <span aria-hidden="true" className="text-muted-foreground">
                        →
                      </span>
                    )}
                    <span className="rounded-full bg-secondary px-3 py-1 font-semibold">
                      {s.station.city}
                      {i > 0 && s.minutes > 0 ? ` · ${formatDuration(s.minutes)}` : ""}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          );
        })}
      </Card>

      {canEdit &&
        (stations.length < 2 ? (
          <Notice tone="info">
            Ajoutez au moins deux gares avant de créer une ligne.{" "}
            <Link to="/pro/gares" className="font-bold text-primary">
              Aller aux gares
            </Link>
          </Notice>
        ) : (
          <NewRoute
            companyId={companyId}
            stations={stations}
            onCreated={() => Promise.all([load(), refreshStatus()]).then(() => undefined)}
          />
        ))}
    </>
  );
}

function NewRoute({
  companyId,
  stations,
  onCreated,
}: {
  companyId: string;
  stations: StationRow[];
  onCreated: () => Promise<void>;
}) {
  const empty: DraftStop[] = [
    { stationId: "", duration: "0" },
    { stationId: "", duration: "" },
  ];
  const [stops, setStops] = useState<DraftStop[]>(empty);
  const [sellSegments, setSellSegments] = useState(true);
  const [withReturn, setWithReturn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const update = (i: number, patch: Partial<DraftStop>) =>
    setStops((list) => list.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const addStop = () =>
    setStops((list) => [...list.slice(0, -1), { stationId: "", duration: "" }, ...list.slice(-1)]);
  const removeStop = (i: number) => setStops((list) => list.filter((_, k) => k !== i));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(null);
    const ids = stops.map((s) => s.stationId);
    if (ids.some((id) => !id)) {
      setError("Choisissez une gare pour chaque arrêt.");
      return;
    }
    if (new Set(ids).size !== ids.length) {
      setError("Une même gare ne peut apparaître qu'une fois sur la ligne.");
      return;
    }
    const minutes: number[] = [];
    for (const [i, s] of stops.entries()) {
      if (i === 0) {
        minutes.push(0);
        continue;
      }
      const m = s.duration.trim() === "" ? 0 : parseDuration(s.duration);
      if (m === null) {
        setError(`Durée illisible à l'arrêt ${i + 1}. Écrivez par exemple « 3h30 ».`);
        return;
      }
      minutes.push(m);
    }
    const allZero = minutes.slice(1).every((m) => m === 0);
    if (!allZero && minutes.some((m, i) => i > 0 && (m === 0 || m < (minutes[i - 1] ?? 0)))) {
      setError("Les durées depuis le départ doivent augmenter d'un arrêt à l'autre.");
      return;
    }
    setBusy(true);
    try {
      const { error: rpcError } = await db.rpc("create_route", {
        p_company: companyId,
        p_station_ids: ids,
        p_minutes: minutes,
        p_sell_segments: sellSegments,
        p_with_return: withReturn,
      });
      if (rpcError) {
        setError(dbMessage(rpcError, "La ligne n'a pas pu être créée. Réessayez."));
        return;
      }
      setStops(empty);
      setDone(withReturn ? "Ligne et ligne retour créées." : "Ligne créée.");
      await onCreated();
    } finally {
      setBusy(false);
    }
  }

  const pairs = sellableSegments(stops.length, sellSegments).length * (withReturn ? 2 : 1);

  return (
    <Card title="Nouvelle ligne">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <ol className="flex flex-col gap-3">
          {stops.map((s, i) => {
            const role = i === 0 ? "Départ" : i === stops.length - 1 ? "Arrivée" : `Arrêt ${i}`;
            return (
              <li key={i} className="grid grid-cols-[1fr_7rem_auto] items-end gap-2">
                <label className="flex flex-col gap-1 text-sm font-semibold text-muted-foreground">
                  {role}
                  <select
                    value={s.stationId}
                    onChange={(e) => update(i, { stationId: e.target.value })}
                    className={inputClass}
                  >
                    <option value="">Choisir une gare</option>
                    {stations.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.city} · {st.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm font-semibold text-muted-foreground">
                  {i === 0 ? "Durée" : "Depuis le départ"}
                  <input
                    value={i === 0 ? "0" : s.duration}
                    disabled={i === 0}
                    onChange={(e) => update(i, { duration: e.target.value })}
                    placeholder="3h30"
                    className={inputClass}
                  />
                </label>
                {i > 0 && i < stops.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => removeStop(i)}
                    aria-label={`Retirer l'arrêt ${i}`}
                    className="h-12 px-3 text-sm font-bold text-primary"
                  >
                    Retirer
                  </button>
                ) : (
                  <span className="w-16" />
                )}
              </li>
            );
          })}
        </ol>
        <button
          type="button"
          onClick={addStop}
          disabled={stops.length >= 12}
          className="w-fit py-2 text-sm font-bold text-primary"
        >
          + Ajouter un arrêt
        </button>

        <div className="flex flex-wrap gap-2">
          <Choice selected={sellSegments} onClick={() => setSellSegments((v) => !v)}>
            Vendre aussi les tronçons
          </Choice>
          <Choice selected={withReturn} onClick={() => setWithReturn((v) => !v)}>
            Créer la ligne retour
          </Choice>
        </div>
        <p className="text-sm text-muted-foreground">
          {pairs} trajet(s) vendable(s){withReturn ? ", aller et retour" : ""}. Les durées sont
          facultatives ; elles servent à proposer les prix des tronçons et à prévenir les voyageurs
          des arrêts.
        </p>

        {error && <Notice>{error}</Notice>}
        {done && <Notice tone="success">{done}</Notice>}
        <Button type="submit" disabled={busy} className="h-12 w-fit rounded-xl px-6 font-extrabold">
          {busy ? "Création…" : "Créer la ligne"}
        </Button>
      </form>
    </Card>
  );
}
