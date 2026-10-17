import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";

import { Choice, inputClass } from "@/components/pro/ui";
import { Button } from "@/components/ui/button";
import { dayLabel, isoDay } from "@/domain/guichet";
import { db } from "@/lib/db";
import { cn } from "@/lib/utils";

/** Recherche d'un trajet : ville de départ, ville d'arrivée, jour. */
export function SearchForm({ initial }: { initial?: { de?: string; a?: string; date?: string } }) {
  const navigate = useNavigate();
  const [cities, setCities] = useState<string[] | null>(null);
  const [from, setFrom] = useState(initial?.de ?? "");
  const [to, setTo] = useState(initial?.a ?? "");
  const [date, setDate] = useState(initial?.date ?? isoDay(0));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void db
      .rpc("served_cities")
      .then(({ data }) => setCities(((data ?? []) as { city: string }[]).map((c) => c.city)))
      .then(undefined, () => setCities([]));
  }, []);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!from || !to) return setError("Choisissez la ville de départ et la ville d'arrivée.");
    if (from === to) return setError("Les villes de départ et d'arrivée sont les mêmes.");
    setError(null);
    void navigate({ to: "/trajets", search: { de: from, a: to, date } });
  }

  const options = cities ?? [];
  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5"
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
        <label className="flex flex-col gap-1.5 text-sm font-bold">
          Départ
          <select
            className={inputClass}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            required
          >
            <option value="">Ville de départ</option>
            {options.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            setFrom(to);
            setTo(from);
          }}
          className="h-12 rounded-xl px-3 text-sm font-bold text-primary hover:bg-secondary"
          aria-label="Inverser départ et arrivée"
        >
          ⇄
        </button>
        <label className="flex flex-col gap-1.5 text-sm font-bold">
          Arrivée
          <select
            className={inputClass}
            value={to}
            onChange={(e) => setTo(e.target.value)}
            required
          >
            <option value="">Ville d'arrivée</option>
            {options.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Jour du voyage">
        {[0, 1, 2].map((o) => (
          <Choice key={o} selected={date === isoDay(o)} onClick={() => setDate(isoDay(o))}>
            {dayLabel(isoDay(o))}
          </Choice>
        ))}
        <input
          type="date"
          aria-label="Autre date"
          className={cn(inputClass, "w-auto")}
          min={isoDay(0)}
          max={isoDay(60)}
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
        />
      </div>
      {cities?.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Les premières compagnies arrivent bientôt sur Tufani.
        </p>
      )}
      {error && <p className="text-sm font-bold text-destructive">{error}</p>}
      <Button type="submit" className="h-14 rounded-2xl text-lg font-extrabold">
        Voir les départs
      </Button>
    </form>
  );
}
