/**
 * Règles du guichet : où le voyageur peut monter, jusqu'où il peut aller,
 * places libres et caisse de l'agent. Fonctions pures, testées.
 */

import type { SeatBooking } from "./seats";

export type RouteStop = { position: number; stationId: string; city: string; minutes: number };

/** Positions où l'on peut monter dans cette gare (jamais le terminus). */
export function boardingPositions(stops: RouteStop[], stationId: string): number[] {
  const last = Math.max(...stops.map((s) => s.position));
  return stops.filter((s) => s.stationId === stationId && s.position < last).map((s) => s.position);
}

/** Destinations possibles depuis `from` : tous les arrêts suivants, ou seulement le terminus. */
export function destinations(stops: RouteStop[], from: number, sellSegments: boolean): RouteStop[] {
  const last = Math.max(...stops.map((s) => s.position));
  const after = stops.filter((s) => s.position > from).sort((a, b) => a.position - b.position);
  if (sellSegments) return after;
  return from === 0 ? after.filter((s) => s.position === last) : [];
}

export type SoldTicket = SeatBooking & { status: "valide" | "embarque" | "annule" };

/** Les billets annulés libèrent leur siège. */
export function activeBookings(tickets: SoldTicket[]): SeatBooking[] {
  return tickets
    .filter((t) => t.status !== "annule")
    .map(({ seat, from, to }) => ({ seat, from, to }));
}

export type CashLine = { price: number; payment_method: string; status: string };

/** Caisse de l'agent : espèces à remettre et ventes mobile money, hors billets annulés. */
export function cashSummary(lines: CashLine[]): {
  tickets: number;
  cash: number;
  mobile: number;
  total: number;
} {
  const valid = lines.filter((l) => l.status !== "annule");
  const cash = valid.filter((l) => l.payment_method === "especes").reduce((s, l) => s + l.price, 0);
  const total = valid.reduce((s, l) => s + l.price, 0);
  return { tickets: valid.length, cash, mobile: total - cash, total };
}

/** « 2026-10-17 » pour aujourd'hui (+ décalage en jours), à l'heure du Mali (UTC). */
export function isoDay(offsetDays = 0, now = new Date()): string {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays),
  );
  return d.toISOString().slice(0, 10);
}

/** Libellé court d'un jour : « Aujourd'hui », « Demain », « sam. 18 oct. ». */
export function dayLabel(iso: string, now = new Date()): string {
  if (iso === isoDay(0, now)) return "Aujourd'hui";
  if (iso === isoDay(1, now)) return "Demain";
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** Heure d'arrivée à un arrêt : départ + durée depuis le départ. « 06:00 » + 210 → « 09:30 ». */
export function addMinutes(time: string, minutes: number): string {
  const [h = 0, m = 0] = time.split(":").map(Number);
  const total = (h * 60 + m + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
