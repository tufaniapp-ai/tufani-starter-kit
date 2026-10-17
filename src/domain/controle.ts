/**
 * Décision du contrôleur à l'embarquement, sans réseau.
 *
 * Entrées : la liste du départ téléchargée sur le téléphone, ce qui a déjà été
 * scanné sur ce téléphone, et le billet présenté (QR déjà vérifié, ou code saisi).
 */

import type { TicketClaims } from "./ticket-qr";

export type ManifestTicket = {
  id: string;
  code: string;
  seat: number;
  name: string;
  from: number;
  to: number;
  status: "valide" | "embarque" | "annule";
  boardedAt: string | null;
};

export type ScanDecision =
  | {
      kind: "ok";
      ticket: Pick<ManifestTicket, "id" | "code" | "seat" | "name" | "from" | "to">;
      sinceDownload: boolean;
    }
  | { kind: "deja"; ticket: ManifestTicket; boardedAt: string }
  | { kind: "annule"; ticket: ManifestTicket }
  | { kind: "autre_depart" }
  | { kind: "faux" }
  | { kind: "inconnu"; code: string };

/** QR signé et vérifié : `claims` ; code saisi à la main : `code`. */
export function decideScan(
  input: { claims: TicketClaims } | { code: string },
  departureId: string,
  manifest: ManifestTicket[],
): ScanDecision {
  if ("claims" in input) {
    const c = input.claims;
    if (c.departureId !== departureId) return { kind: "autre_depart" };
    const known = manifest.find((t) => t.id === c.ticketId);
    if (!known) {
      // Billet vendu après le téléchargement de la liste : la signature suffit à le prouver.
      return {
        kind: "ok",
        sinceDownload: true,
        ticket: { id: c.ticketId, code: c.code, seat: c.seat, name: "", from: c.from, to: c.to },
      };
    }
    return fromManifest(known);
  }
  const code = input.code.trim().toUpperCase();
  const known = manifest.find((t) => t.code === code);
  return known ? fromManifest(known) : { kind: "inconnu", code };
}

function fromManifest(t: ManifestTicket): ScanDecision {
  if (t.status === "annule") return { kind: "annule", ticket: t };
  if (t.boardedAt) return { kind: "deja", ticket: t, boardedAt: t.boardedAt };
  return { kind: "ok", sinceDownload: false, ticket: t };
}

/** « TFN-K8RLJ8 », sans tenir compte des espaces et minuscules ; sinon null. */
export function normalizeCode(input: string): string | null {
  const s = input.trim().toUpperCase().replace(/\s+/g, "");
  const m = /^(?:TFN-?)?([A-Z0-9]{6})$/.exec(s);
  return m ? `TFN-${m[1]}` : null;
}
