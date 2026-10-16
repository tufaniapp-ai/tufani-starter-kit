import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Card, Choice, Notice, PageTitle, dbMessage } from "@/components/pro/ui";
import { Button } from "@/components/ui/button";
import { formatFcfa } from "@/domain/money";
import { can } from "@/domain/roles";
import { CANCELLATION_RULES, refundAmount, type CancellationPreset } from "@/domain/setup";
import { db } from "@/lib/db";
import { usePro } from "@/lib/pro-context";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/pro/annulation")({
  component: Annulation,
});

const PRESETS = Object.keys(CANCELLATION_RULES) as CancellationPreset[];

function Annulation() {
  const { membership, refreshStatus } = usePro();
  const companyId = membership.company_id;
  const canEdit = can(membership.roles, "configurer_compagnie");
  const [preset, setPreset] = useState<CancellationPreset>("standard");
  const [freeChange, setFreeChange] = useState(true);
  const [saved, setSaved] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void db
      .from("cancellation_policies")
      .select("preset, free_change_once")
      .eq("company_id", companyId)
      .maybeSingle()
      .then(({ data }) => {
        const row = data as { preset: CancellationPreset; free_change_once: boolean } | null;
        if (row) {
          setPreset(row.preset);
          setFreeChange(row.free_change_once);
        }
        setSaved(Boolean(row));
      });
  }, [companyId]);

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const { error: upsertError } = await db.from("cancellation_policies").upsert({
        company_id: companyId,
        preset,
        free_change_once: freeChange,
        updated_at: new Date().toISOString(),
      });
      if (upsertError) {
        setError(dbMessage(upsertError, "La règle n'a pas pu être enregistrée."));
        return;
      }
      setSaved(true);
      await refreshStatus();
    } finally {
      setBusy(false);
    }
  }

  const rule = CANCELLATION_RULES[preset];
  const example = 6000;

  return (
    <>
      <PageTitle step="Étape 5" title="Annulation et remboursement">
        Le voyageur voit cette règle avant de payer. Le montant remboursé est calculé et renvoyé
        automatiquement.
      </PageTitle>

      <div className="grid gap-3 sm:grid-cols-3">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            disabled={!canEdit}
            aria-pressed={preset === p}
            onClick={() => setPreset(p)}
            className={cn(
              "flex flex-col gap-1 rounded-2xl border-2 p-4 text-left",
              preset === p ? "border-primary bg-accent" : "border-input bg-card",
            )}
          >
            <span className="font-extrabold">{CANCELLATION_RULES[p].label}</span>
            <span className="text-sm text-muted-foreground">{CANCELLATION_RULES[p].summary}</span>
          </button>
        ))}
      </div>

      <Card title="Ce que récupère le voyageur">
        <p className="text-sm">
          Exemple pour un billet à {formatFcfa(example)} :{" "}
          {formatFcfa(refundAmount(preset, example, 48))} s'il annule 2 jours avant,{" "}
          {formatFcfa(refundAmount(preset, example, 5))} s'il annule 5 h avant, rien après le
          départ.
        </p>
        <Choice
          selected={freeChange}
          onClick={() => canEdit && setFreeChange((v) => !v)}
          className="w-fit"
        >
          Changement de date gratuit une fois, jusqu'à 2 h avant
        </Choice>
        <p className="rounded-xl bg-secondary px-4 py-3 text-sm text-muted-foreground">
          <strong className="text-foreground">Garantie Tufani :</strong> un départ annulé par la
          compagnie est toujours remboursé à 100 %, frais compris. Cette règle ne se modifie pas.
        </p>
        <p className="text-xs text-muted-foreground">
          Règle affichée au voyageur : « {rule.summary} ».
        </p>
      </Card>

      {canEdit && (
        <div className="flex flex-col gap-3">
          {error && <Notice>{error}</Notice>}
          {saved && !busy && !error && (
            <Notice tone="success">Règle enregistrée : {rule.label}.</Notice>
          )}
          <Button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="h-12 w-fit rounded-xl px-6 font-extrabold"
          >
            {busy ? "Enregistrement…" : "Enregistrer cette règle"}
          </Button>
        </div>
      )}
    </>
  );
}
