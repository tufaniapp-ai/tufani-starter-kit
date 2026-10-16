import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";

import { Card, Choice, Field, Notice, PageTitle, dbMessage, inputClass } from "@/components/pro/ui";
import { Button } from "@/components/ui/button";
import { formatLocalPhone, normalizeMaliPhone } from "@/domain/phone";
import { can } from "@/domain/roles";
import { db } from "@/lib/db";
import { usePro } from "@/lib/pro-context";

export const Route = createFileRoute("/pro/versements")({
  component: Versements,
});

type Method = "wave" | "orange_money" | "banque";
type Frequency = "quotidien" | "hebdomadaire" | "bimensuel";
type PayoutRow = {
  method: Method;
  account: string;
  holder: string;
  frequency: Frequency;
  hold_until: string | null;
};

const METHODS: { key: Method; label: string; help: string }[] = [
  { key: "wave", label: "Wave", help: "Reçu en quelques minutes" },
  { key: "orange_money", label: "Orange Money", help: "Reçu en quelques minutes" },
  { key: "banque", label: "Compte bancaire", help: "Virement, 1 à 2 jours ouvrés" },
];
const FREQUENCIES: { key: Frequency; label: string }[] = [
  { key: "quotidien", label: "Chaque jour" },
  { key: "hebdomadaire", label: "Chaque lundi" },
  { key: "bimensuel", label: "Le 1er et le 15 du mois" },
];

function Versements() {
  const { membership, refreshStatus } = usePro();
  const companyId = membership.company_id;
  const canEdit = can(membership.roles, "changer_compte_versement");
  const canSee = canEdit || membership.roles.includes("comptable");
  const [current, setCurrent] = useState<PayoutRow | null | undefined>(undefined);
  const [method, setMethod] = useState<Method>("wave");
  const [account, setAccount] = useState("");
  const [holder, setHolder] = useState(membership.company.name);
  const [frequency, setFrequency] = useState<Frequency>("hebdomadaire");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!canSee) return;
    void db
      .from("payout_accounts")
      .select("method, account, holder, frequency, hold_until")
      .eq("company_id", companyId)
      .maybeSingle()
      .then(({ data }) => {
        const row = data as PayoutRow | null;
        setCurrent(row);
        if (row) {
          setMethod(row.method);
          setAccount(row.method === "banque" ? row.account : formatLocalPhone(row.account));
          setHolder(row.holder);
          setFrequency(row.frequency);
        }
      });
  }, [companyId, canSee]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    let value = account.trim();
    if (method !== "banque") {
      const phone = normalizeMaliPhone(value);
      if (!phone) {
        setError("Indiquez un numéro malien valide (8 chiffres).");
        return;
      }
      value = phone;
    } else if (value.replace(/\s/g, "").length < 10) {
      setError("Indiquez le RIB ou l'IBAN complet.");
      return;
    }
    if (holder.trim().length < 2) {
      setError("Indiquez le titulaire du compte.");
      return;
    }
    setBusy(true);
    try {
      const { error: rpcError } = await db.rpc("set_payout_account", {
        p_company: companyId,
        p_method: method,
        p_account: value,
        p_holder: holder.trim(),
        p_frequency: frequency,
      });
      if (rpcError) {
        setError(dbMessage(rpcError, "Le compte n'a pas pu être enregistré."));
        return;
      }
      const { data } = await db
        .from("payout_accounts")
        .select("method, account, holder, frequency, hold_until")
        .eq("company_id", companyId)
        .maybeSingle();
      setCurrent(data as PayoutRow | null);
      setDone(true);
      await refreshStatus();
    } finally {
      setBusy(false);
    }
  }

  const held = current?.hold_until && new Date(current.hold_until).getTime() > Date.now();

  if (!canSee) {
    return (
      <>
        <PageTitle step="Étape 7" title="Versements" />
        <Notice tone="info">Seuls le gérant et le comptable voient le compte de versement.</Notice>
      </>
    );
  }

  return (
    <>
      <PageTitle step="Étape 7" title="Où recevoir votre argent">
        L'argent des ventes en ligne vous est reversé automatiquement, commission déduite, avec le
        détail billet par billet. Les espèces du guichet restent chez vous.
      </PageTitle>

      {held && current?.hold_until && (
        <Notice>
          Compte modifié récemment : les versements sont suspendus jusqu'au{" "}
          {new Date(current.hold_until).toLocaleString("fr-FR", {
            dateStyle: "long",
            timeStyle: "short",
          })}
          . C'est une protection en cas de vol de téléphone.
        </Notice>
      )}

      <Card>
        <form onSubmit={save} className="flex flex-col gap-4">
          <div className="grid gap-2 sm:grid-cols-3">
            {METHODS.map((m) => (
              <Choice
                key={m.key}
                selected={method === m.key}
                onClick={() => canEdit && setMethod(m.key)}
                className="flex flex-col items-start gap-1 py-3 text-left"
              >
                <span>{m.label}</span>
                <span className="text-xs font-normal text-muted-foreground">{m.help}</span>
              </Choice>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label={
                method === "banque"
                  ? "RIB ou IBAN"
                  : `Numéro ${method === "wave" ? "Wave" : "Orange Money"}`
              }
              id="pay-account"
            >
              <input
                id="pay-account"
                disabled={!canEdit}
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                placeholder={method === "banque" ? "ML…" : "76 12 34 21"}
                className={inputClass}
              />
            </Field>
            <Field label="Titulaire du compte" id="pay-holder">
              <input
                id="pay-holder"
                disabled={!canEdit}
                value={holder}
                onChange={(e) => setHolder(e.target.value)}
                maxLength={80}
                className={inputClass}
              />
            </Field>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold text-muted-foreground">Fréquence</span>
            <div className="flex flex-wrap gap-2">
              {FREQUENCIES.map((f) => (
                <Choice
                  key={f.key}
                  selected={frequency === f.key}
                  onClick={() => canEdit && setFrequency(f.key)}
                >
                  {f.label}
                </Choice>
              ))}
            </div>
          </div>
          <p className="rounded-xl bg-secondary px-4 py-3 text-sm text-muted-foreground">
            Si ce compte est changé plus tard, les versements sont suspendus 48 h et le changement
            est inscrit au journal.
          </p>
          {error && <Notice>{error}</Notice>}
          {done && <Notice tone="success">Compte de versement enregistré.</Notice>}
          {canEdit && (
            <Button
              type="submit"
              disabled={busy}
              className="h-12 w-fit rounded-xl px-6 font-extrabold"
            >
              {busy
                ? "Enregistrement…"
                : current
                  ? "Mettre à jour le compte"
                  : "Enregistrer le compte"}
            </Button>
          )}
        </form>
      </Card>
    </>
  );
}
