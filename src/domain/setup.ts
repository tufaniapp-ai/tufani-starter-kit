/**
 * Règles de la mise en route d'une compagnie : tronçons vendables, prix proposés,
 * semaine type et règles d'annulation. Fonctions pures, testées.
 */

export type Stop = { position: number; minutes: number };
export type FarePair = { from: number; to: number };

/** Tronçons vendables : tous les couples d'arrêts, ou seulement départ → arrivée. */
export function sellableSegments(stopCount: number, sellSegments: boolean): FarePair[] {
  if (stopCount < 2) return [];
  if (!sellSegments) return [{ from: 0, to: stopCount - 1 }];
  const out: FarePair[] = [];
  for (let from = 0; from < stopCount - 1; from += 1) {
    for (let to = from + 1; to < stopCount; to += 1) out.push({ from, to });
  }
  return out;
}

/**
 * Prix proposé pour un tronçon sans prix, au prorata du temps de parcours
 * (à défaut, du nombre d'arrêts), à partir du prix connu le plus long.
 * Arrondi à la centaine supérieure : 5 430 F → 5 500 F.
 */
export function suggestFare(
  stops: Stop[],
  known: (FarePair & { price: number })[],
  pair: FarePair,
): number | null {
  const reference = [...known].sort((a, b) => b.to - b.from - (a.to - a.from))[0];
  if (!reference) return null;
  const minutesOf = (p: number) => stops.find((s) => s.position === p)?.minutes;
  const span = (f: number, t: number) => {
    const a = minutesOf(f);
    const b = minutesOf(t);
    return a !== undefined && b !== undefined && b > a ? b - a : t - f;
  };
  const useMinutes = stops.every((s) => s.position === 0 || s.minutes > 0);
  const refSpan = useMinutes ? span(reference.from, reference.to) : reference.to - reference.from;
  const pairSpan = useMinutes ? span(pair.from, pair.to) : pair.to - pair.from;
  if (refSpan <= 0) return null;
  const raw = (reference.price * pairSpan) / refSpan;
  return Math.max(100, Math.ceil(raw / 100) * 100);
}

export const WEEKDAYS = [
  { n: 1, short: "L", long: "Lundi" },
  { n: 2, short: "M", long: "Mardi" },
  { n: 3, short: "M", long: "Mercredi" },
  { n: 4, short: "J", long: "Jeudi" },
  { n: 5, short: "V", long: "Vendredi" },
  { n: 6, short: "S", long: "Samedi" },
  { n: 7, short: "D", long: "Dimanche" },
] as const;

/** Jour de la semaine au format 1 = lundi … 7 = dimanche (calendrier UTC). */
export function isoWeekday(date: Date): number {
  const d = date.getUTCDay();
  return d === 0 ? 7 : d;
}

/** Nombre de départs créés sur `days` jours à partir du lendemain de `from`. */
export function departuresOver(schedules: { weekdays: number[] }[], from: Date, days = 60): number {
  let total = 0;
  for (let k = 1; k <= days; k += 1) {
    const day = new Date(
      Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + k),
    );
    const wd = isoWeekday(day);
    total += schedules.filter((s) => s.weekdays.includes(wd)).length;
  }
  return total;
}

/** « 06:00 » → valide ; renvoie null si l'heure n'existe pas. */
export function normalizeTime(input: string): string | null {
  const m = /^(\d{1,2})[:hH.]?(\d{2})$/.exec(input.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export type CancellationPreset = "souple" | "standard" | "stricte";

/** Part remboursée (0 à 1) selon le nombre d'heures restant avant le départ. */
export const CANCELLATION_RULES: Record<
  CancellationPreset,
  { label: string; summary: string; tiers: { hoursBefore: number; refund: number }[] }
> = {
  souple: {
    label: "Souple",
    summary: "100 % jusqu'à 2 h avant, puis 50 %",
    tiers: [
      { hoursBefore: 2, refund: 1 },
      { hoursBefore: 0, refund: 0.5 },
    ],
  },
  standard: {
    label: "Standard",
    summary: "100 % jusqu'à 24 h avant, puis 50 %",
    tiers: [
      { hoursBefore: 24, refund: 1 },
      { hoursBefore: 0, refund: 0.5 },
    ],
  },
  stricte: {
    label: "Stricte",
    summary: "50 % jusqu'à 24 h avant, puis rien",
    tiers: [
      { hoursBefore: 24, refund: 0.5 },
      { hoursBefore: 0, refund: 0 },
    ],
  },
};

/** Montant remboursé (FCFA entiers) ; après le départ, rien. */
export function refundAmount(
  preset: CancellationPreset,
  price: number,
  hoursBeforeDeparture: number,
): number {
  if (hoursBeforeDeparture < 0) return 0;
  const tier = CANCELLATION_RULES[preset].tiers.find((t) => hoursBeforeDeparture >= t.hoursBefore);
  return Math.floor(price * (tier?.refund ?? 0));
}

/** « 3h30 », « 3 h », « 45 », « 1:15 » → minutes ; null si illisible. Un nombre seul = minutes. */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, "");
  if (s === "") return null;
  const hm = /^(\d{1,2})(?:h|:)(\d{0,2})(?:min)?$/.exec(s);
  if (hm) {
    const h = Number(hm[1]);
    const m = hm[2] ? Number(hm[2]) : 0;
    return m < 60 ? h * 60 + m : null;
  }
  const only = /^(\d{1,4})(?:min)?$/.exec(s);
  return only ? Number(only[1]) : null;
}

/** 210 → « 3 h 30 » ; 45 → « 45 min ». */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
}
