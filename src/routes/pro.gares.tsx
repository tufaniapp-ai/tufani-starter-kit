import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { Card, Field, Notice, PageTitle, dbMessage, inputClass } from "@/components/pro/ui";
import { Button } from "@/components/ui/button";
import { MALI_CITIES } from "@/domain/cities";
import { can } from "@/domain/roles";
import { db, type StationRow } from "@/lib/db";
import { usePro } from "@/lib/pro-context";

export const Route = createFileRoute("/pro/gares")({
  component: Gares,
});

function Gares() {
  const { membership, refreshStatus } = usePro();
  const companyId = membership.company_id;
  const canEdit = can(membership.roles, "configurer_compagnie");
  const [stations, setStations] = useState<StationRow[] | null>(null);
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await db
      .from("stations")
      .select("id, company_id, name, city, active")
      .eq("company_id", companyId)
      .order("city")
      .order("name");
    setStations((data ?? []) as StationRow[]);
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

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
            : dbMessage(insertError, "La gare n'a pas pu être ajoutée."),
        );
        return;
      }
      setName("");
      setCity("");
      await Promise.all([load(), refreshStatus()]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageTitle step="Étape 1" title="Vos gares">
        Les lieux d'où partent et où s'arrêtent vos bus. Chaque vente, caisse et embarquement sera
        rattaché à une gare.
      </PageTitle>

      <Card
        title="Gares enregistrées"
        aside={
          stations && (
            <span className="text-sm text-muted-foreground">{stations.length} gare(s)</span>
          )
        }
      >
        {stations === null && <p className="text-sm text-muted-foreground">Chargement…</p>}
        {stations?.length === 0 && (
          <p className="text-sm text-muted-foreground">Aucune gare pour l'instant.</p>
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
      </Card>

      {canEdit && (
        <Card title="Ajouter une gare">
          <form onSubmit={add} className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nom de la gare" id="station-name">
                <input
                  id="station-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex. Sogoniko"
                  maxLength={80}
                  className={inputClass}
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
                  className={inputClass}
                />
                <datalist id="mali-cities">
                  {MALI_CITIES.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </Field>
            </div>
            {error && <Notice>{error}</Notice>}
            <Button
              type="submit"
              disabled={busy}
              className="h-12 w-fit rounded-xl px-6 font-extrabold"
            >
              {busy ? "Ajout…" : "Ajouter la gare"}
            </Button>
          </form>
        </Card>
      )}
    </>
  );
}
