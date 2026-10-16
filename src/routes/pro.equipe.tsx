import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { Card, Choice, Field, Notice, PageTitle, dbMessage, inputClass } from "@/components/pro/ui";
import { Button } from "@/components/ui/button";
import { formatLocalPhone, maskPhone, normalizeMaliPhone } from "@/domain/phone";
import { MEMBER_ROLES, ROLE_LABELS, can, type MemberRole } from "@/domain/roles";
import { db, type StationRow } from "@/lib/db";
import { usePro } from "@/lib/pro-context";
import { sendInviteSms } from "@/lib/team.functions";

export const Route = createFileRoute("/pro/equipe")({
  component: Equipe,
});

type TeamRow = {
  id: string;
  full_name: string;
  phone: string;
  roles: MemberRole[];
  all_stations: boolean;
  active: boolean;
  user_id: string | null;
  member_stations: { station: { name: string; city: string } }[];
};

const ROLE_HELP: Record<MemberRole, string> = {
  gerant: "Tout voir et tout régler : tarifs, départs, équipe, versements, remboursements.",
  chef_de_gare: "Gère sa gare : départs qui y passent, ses agents, validation des caisses.",
  agent: "Vend des billets dans sa gare et voit sa propre caisse.",
  controleur: "Scanne les billets et voit la liste des passagers de sa gare.",
  comptable: "Voit les ventes, les caisses et les versements, et exporte. Ne modifie rien.",
};

function Equipe() {
  const { membership, refreshStatus } = usePro();
  const companyId = membership.company_id;
  const canEdit = can(membership.roles, "gerer_equipe");
  const [team, setTeam] = useState<TeamRow[] | null>(null);
  const [stations, setStations] = useState<StationRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [t, s] = await Promise.all([
      db
        .from("members")
        .select(
          "id, full_name, phone, roles, all_stations, active, user_id, member_stations(station:stations(name, city))",
        )
        .eq("company_id", companyId)
        .order("active", { ascending: false })
        .order("invited_at"),
      db
        .from("stations")
        .select("id, company_id, name, city, active")
        .eq("company_id", companyId)
        .eq("active", true)
        .order("city"),
    ]);
    setTeam((t.data ?? []) as unknown as TeamRow[]);
    setStations((s.data ?? []) as StationRow[]);
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function deactivate(m: TeamRow) {
    setError(null);
    const { error: rpcError } = await db.rpc("deactivate_member", { p_member: m.id });
    if (rpcError) {
      setError(dbMessage(rpcError, "Impossible de retirer cette personne."));
      return;
    }
    await Promise.all([load(), refreshStatus()]);
  }

  return (
    <>
      <PageTitle step="Étape 6" title="Votre équipe">
        Invitez chaque personne avec son propre numéro : jamais de compte partagé. Elle reçoit un
        SMS et se connecte avec un code.
      </PageTitle>

      <Card
        title="Membres"
        aside={
          team && (
            <span className="text-sm text-muted-foreground">
              {team.filter((m) => m.active).length} actif(s)
            </span>
          )
        }
      >
        {team === null && <p className="text-sm text-muted-foreground">Chargement…</p>}
        {team?.map((m) => {
          const me = m.id === membership.id;
          const where = m.all_stations
            ? "Toutes les gares"
            : m.member_stations.map((s) => s.station.name).join(", ") || "Aucune gare";
          return (
            <div
              key={m.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3 first:border-t-0 first:pt-0"
            >
              <div className="flex min-w-[12rem] flex-1 flex-col">
                <span className="font-bold">
                  {m.full_name}
                  {me ? " (vous)" : ""}
                </span>
                <span className="text-xs text-muted-foreground">
                  {canEdit ? formatLocalPhone(m.phone) : maskPhone(m.phone)} · {where}
                </span>
              </div>
              <span className="rounded-full bg-secondary px-3 py-1 text-xs font-bold">
                {m.roles.map((r) => ROLE_LABELS[r]).join(", ")}
              </span>
              <span
                className={
                  !m.active
                    ? "rounded-full bg-secondary px-3 py-1 text-xs font-bold text-muted-foreground"
                    : m.user_id
                      ? "rounded-full bg-accent px-3 py-1 text-xs font-bold text-accent-foreground"
                      : "rounded-full bg-warning px-3 py-1 text-xs font-bold text-warning-foreground"
                }
              >
                {!m.active ? "Retiré" : m.user_id ? "Actif" : "Invitation envoyée"}
              </span>
              {canEdit && m.active && !me && (
                <button
                  type="button"
                  onClick={() => void deactivate(m)}
                  className="py-2 text-sm font-bold text-destructive"
                >
                  Retirer l'accès
                </button>
              )}
            </div>
          );
        })}
        {error && <Notice>{error}</Notice>}
      </Card>

      {canEdit && (
        <Invite
          companyId={companyId}
          stations={stations}
          onInvited={() => Promise.all([load(), refreshStatus()]).then(() => undefined)}
        />
      )}
    </>
  );
}

function Invite({
  companyId,
  stations,
  onInvited,
}: {
  companyId: string;
  stations: StationRow[];
  onInvited: () => Promise<void>;
}) {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<MemberRole>("agent");
  const [stationIds, setStationIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const companyWide = role === "gerant" || role === "comptable";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(null);
    const normalized = normalizeMaliPhone(phone);
    if (fullName.trim().length < 2) {
      setError("Indiquez le nom de la personne.");
      return;
    }
    if (!normalized) {
      setError("Ce numéro n'est pas un numéro malien valide (8 chiffres).");
      return;
    }
    if (!companyWide && stationIds.length === 0) {
      setError("Choisissez au moins une gare pour ce rôle.");
      return;
    }
    setBusy(true);
    try {
      const { data, error: rpcError } = await db.rpc("invite_member", {
        p_company: companyId,
        p_phone: normalized,
        p_full_name: fullName.trim(),
        p_roles: [role],
        p_station_ids: companyWide ? [] : stationIds,
      });
      if (rpcError) {
        setError(
          rpcError.code === "23505"
            ? "Ce numéro fait déjà partie de l'équipe."
            : dbMessage(rpcError, "L'invitation n'a pas pu être enregistrée."),
        );
        return;
      }
      const sms = await sendInviteSms({ data: { memberId: String(data) } }).catch(() => ({
        ok: false,
      }));
      setDone(
        sms.ok
          ? `${fullName.trim()} est invité(e). Un SMS a été envoyé au ${formatLocalPhone(normalized)}.`
          : `${fullName.trim()} est invité(e), mais le SMS n'a pas pu partir. Prévenez la personne de se connecter avec ce numéro.`,
      );
      setFullName("");
      setPhone("");
      setStationIds([]);
      await onInvited();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Inviter une personne">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nom" id="inv-name">
            <input
              id="inv-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Ex. Awa Sangaré"
              maxLength={80}
              className={inputClass}
            />
          </Field>
          <Field label="Téléphone" id="inv-phone">
            <input
              id="inv-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="76 12 34 21"
              className={inputClass}
            />
          </Field>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold text-muted-foreground">Rôle</span>
          <div role="radiogroup" aria-label="Rôle" className="flex flex-wrap gap-2">
            {MEMBER_ROLES.map((r) => (
              <Choice key={r} selected={role === r} onClick={() => setRole(r)}>
                {ROLE_LABELS[r]}
              </Choice>
            ))}
          </div>
          <p className="rounded-xl bg-secondary px-4 py-3 text-sm">
            <strong>{ROLE_LABELS[role]}</strong> · {ROLE_HELP[role]}
          </p>
        </div>
        {!companyWide && (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold text-muted-foreground">Gare(s)</span>
            {stations.length === 0 && (
              <p className="text-sm text-muted-foreground">Ajoutez d'abord des gares.</p>
            )}
            <div className="flex flex-wrap gap-2">
              {stations.map((s) => {
                const on = stationIds.includes(s.id);
                return (
                  <Choice
                    key={s.id}
                    selected={on}
                    onClick={() =>
                      setStationIds((ids) => (on ? ids.filter((x) => x !== s.id) : [...ids, s.id]))
                    }
                  >
                    {s.name} · {s.city}
                  </Choice>
                );
              })}
            </div>
          </div>
        )}
        {error && <Notice>{error}</Notice>}
        {done && <Notice tone="success">{done}</Notice>}
        <Button type="submit" disabled={busy} className="h-12 w-fit rounded-xl px-6 font-extrabold">
          {busy ? "Invitation…" : "Envoyer l'invitation par SMS"}
        </Button>
      </form>
    </Card>
  );
}
