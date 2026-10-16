import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { Card, Choice, Field, Notice, PageTitle, dbMessage, inputClass } from "@/components/pro/ui";
import { Button } from "@/components/ui/button";
import { can } from "@/domain/roles";
import { BUS_MODELS, capacity, seatMap, type BusModel } from "@/domain/seats";
import { db } from "@/lib/db";
import { usePro } from "@/lib/pro-context";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/pro/bus")({
  component: Bus,
});

type ModelRow = { id: string; name: string; seat_rows: number; pattern: string; capacity: number };
type BusRow = { id: string; label: string; plate: string | null; model_id: string };

const toPattern = (m: BusModel) => m.pattern.map((s) => (s ? "1" : "0")).join("");
const fromRow = (r: ModelRow): BusModel => ({
  id: r.id,
  name: r.name,
  rows: r.seat_rows,
  pattern: [...r.pattern].map((c) => c === "1"),
});

function SeatPreview({ model, active }: { model: BusModel; active: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={cn("grid w-fit gap-[3px] rounded-lg p-2", active ? "bg-accent" : "bg-secondary")}
      style={{ gridTemplateColumns: `repeat(${model.pattern.length}, 8px)` }}
    >
      {seatMap(model)
        .flat()
        .map((c, i) => (
          <span
            key={i}
            className={cn(
              "h-[6px] w-2 rounded-[2px]",
              c.kind === "seat" ? (active ? "bg-primary" : "bg-muted-foreground/50") : "",
            )}
          />
        ))}
    </div>
  );
}

function Bus() {
  const { membership, refreshStatus } = usePro();
  const companyId = membership.company_id;
  const canEdit = can(membership.roles, "configurer_compagnie");
  const [models, setModels] = useState<ModelRow[] | null>(null);
  const [buses, setBuses] = useState<BusRow[]>([]);

  const load = useCallback(async () => {
    const [m, b] = await Promise.all([
      db
        .from("bus_models")
        .select("id, name, seat_rows, pattern, capacity")
        .eq("company_id", companyId)
        .order("created_at"),
      db
        .from("buses")
        .select("id, label, plate, model_id")
        .eq("company_id", companyId)
        .eq("active", true)
        .order("label"),
    ]);
    setModels((m.data ?? []) as ModelRow[]);
    setBuses((b.data ?? []) as BusRow[]);
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const reload = () => Promise.all([load(), refreshStatus()]).then(() => undefined);

  return (
    <>
      <PageTitle step="Étape 3" title="Vos bus">
        Choisissez les modèles qui ressemblent à vos bus, puis enregistrez chaque bus. On vend sur
        le modèle ; le bus réel est choisi le jour du départ.
      </PageTitle>

      <Card title="Modèles de bus">
        {models === null && <p className="text-sm text-muted-foreground">Chargement…</p>}
        {models?.length === 0 && (
          <p className="text-sm text-muted-foreground">Aucun modèle pour l'instant.</p>
        )}
        {models && models.length > 0 && (
          <ul className="flex flex-wrap gap-3">
            {models.map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-3 rounded-xl border-2 border-input p-3"
              >
                <SeatPreview model={fromRow(m)} active />
                <div className="flex flex-col">
                  <span className="font-bold">{m.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {m.capacity} places · {buses.filter((b) => b.model_id === m.id).length} bus
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
        {canEdit && <AddModel companyId={companyId} existing={models ?? []} onAdded={reload} />}
      </Card>

      {models && models.length > 0 && (
        <Card
          title="Vos bus"
          aside={<span className="text-sm text-muted-foreground">{buses.length} bus</span>}
        >
          {buses.length === 0 && (
            <p className="text-sm text-muted-foreground">Aucun bus enregistré.</p>
          )}
          {buses.length > 0 && (
            <ul className="flex flex-col">
              {buses.map((b) => (
                <li
                  key={b.id}
                  className="flex flex-wrap gap-x-4 border-t py-2 text-sm first:border-t-0"
                >
                  <span className="w-24 font-bold">{b.label}</span>
                  <span className="text-muted-foreground">
                    {models.find((m) => m.id === b.model_id)?.name}
                  </span>
                  {b.plate && <span className="text-muted-foreground">· {b.plate}</span>}
                </li>
              ))}
            </ul>
          )}
          {canEdit && (
            <AddBus companyId={companyId} models={models} buses={buses} onAdded={reload} />
          )}
        </Card>
      )}
    </>
  );
}

function AddModel({
  companyId,
  existing,
  onAdded,
}: {
  companyId: string;
  existing: ModelRow[];
  onAdded: () => Promise<void>;
}) {
  const [preset, setPreset] = useState(BUS_MODELS[1]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = BUS_MODELS.find((m) => m.id === preset);

  async function add() {
    if (!chosen) return;
    setError(null);
    setBusy(true);
    try {
      const { error: insertError } = await db.from("bus_models").insert({
        company_id: companyId,
        name: `${chosen.name} · ${capacity(chosen)} places`,
        seat_rows: chosen.rows,
        pattern: toPattern(chosen),
      });
      if (insertError) {
        setError(dbMessage(insertError, "Le modèle n'a pas pu être ajouté."));
        return;
      }
      await onAdded();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t pt-4">
      <span className="text-sm font-semibold text-muted-foreground">Ajouter un modèle</span>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {BUS_MODELS.map((m) => {
          const taken = existing.some((e) => e.seat_rows === m.rows && e.pattern === toPattern(m));
          return (
            <button
              key={m.id}
              type="button"
              disabled={taken}
              aria-pressed={preset === m.id}
              onClick={() => setPreset(m.id)}
              className={cn(
                "flex flex-col items-start gap-2 rounded-xl border-2 p-3 text-left disabled:opacity-40",
                preset === m.id ? "border-primary bg-accent" : "border-input bg-card",
              )}
            >
              <SeatPreview model={m} active={preset === m.id} />
              <span className="text-sm font-bold">{m.name}</span>
              <span className="text-xs text-muted-foreground">
                {taken ? "Déjà ajouté" : `${capacity(m)} places`}
              </span>
            </button>
          );
        })}
      </div>
      {error && <Notice>{error}</Notice>}
      <Button
        type="button"
        onClick={() => void add()}
        disabled={busy || !chosen}
        className="h-11 w-fit rounded-xl px-5 font-extrabold"
      >
        {busy ? "Ajout…" : "Ajouter ce modèle"}
      </Button>
    </div>
  );
}

function AddBus({
  companyId,
  models,
  buses,
  onAdded,
}: {
  companyId: string;
  models: ModelRow[];
  buses: BusRow[];
  onAdded: () => Promise<void>;
}) {
  const [modelId, setModelId] = useState(models[0]?.id ?? "");
  const [count, setCount] = useState(1);
  const [plate, setPlate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!modelId) return;
    const used = new Set(buses.map((b) => b.label));
    const labels: string[] = [];
    for (let n = 1; labels.length < count && n < 1000; n += 1) {
      const label = `Bus ${String(n).padStart(2, "0")}`;
      if (!used.has(label)) labels.push(label);
    }
    setBusy(true);
    try {
      const rows = labels.map((label, i) => ({
        company_id: companyId,
        model_id: modelId,
        label,
        plate: count === 1 && i === 0 && plate.trim() ? plate.trim().toUpperCase() : null,
      }));
      const { error: insertError } = await db.from("buses").insert(rows);
      if (insertError) {
        setError(dbMessage(insertError, "Les bus n'ont pas pu être ajoutés."));
        return;
      }
      setPlate("");
      setCount(1);
      await onAdded();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={add} className="flex flex-col gap-3 border-t pt-4">
      <span className="text-sm font-semibold text-muted-foreground">Ajouter des bus</span>
      <div className="flex flex-wrap gap-2">
        {models.map((m) => (
          <Choice key={m.id} selected={modelId === m.id} onClick={() => setModelId(m.id)}>
            {m.name}
          </Choice>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Combien ?" id="bus-count">
          <input
            id="bus-count"
            type="number"
            min={1}
            max={30}
            value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
            className={inputClass}
          />
        </Field>
        <Field label="Immatriculation (facultatif, pour un seul bus)" id="bus-plate">
          <input
            id="bus-plate"
            value={plate}
            disabled={count > 1}
            onChange={(e) => setPlate(e.target.value)}
            maxLength={20}
            className={inputClass}
          />
        </Field>
      </div>
      {error && <Notice>{error}</Notice>}
      <Button type="submit" disabled={busy} className="h-11 w-fit rounded-xl px-5 font-extrabold">
        {busy ? "Ajout…" : count > 1 ? `Ajouter ${count} bus` : "Ajouter le bus"}
      </Button>
    </form>
  );
}
