/**
 * Plans de bus et disponibilité des sièges par tronçon.
 *
 * Une ligne est une suite d'arrêts (index 0 = départ). Un billet occupe un siège
 * du point `from` au point `to` (from < to). Deux billets se gênent seulement si
 * leurs tronçons se chevauchent : Bamako→Ségou et Ségou→Mopti peuvent partager
 * le même siège. C'est ce qui permet de revendre à Ségou le siège libéré.
 *
 * Ce module est la règle de référence ; la base de données l'applique aussi
 * (contrainte d'exclusion) pour que deux ventes simultanées ne passent jamais.
 */

export type Cell = { kind: "seat"; number: number; window: boolean } | { kind: "aisle" };

export type BusModel = {
  id: string;
  name: string;
  rows: number;
  /** Une rangée, de gauche à droite : true = siège, false = couloir. */
  pattern: boolean[];
};

export const BUS_MODELS: BusModel[] = [
  { id: "grand-2-2", name: "Grand bus 2+2", rows: 15, pattern: [true, true, false, true, true] },
  {
    id: "standard-2-2",
    name: "Bus standard 2+2",
    rows: 11,
    pattern: [true, true, false, true, true],
  },
  { id: "confort-2-1", name: "Car confort 2+1", rows: 11, pattern: [true, true, false, true] },
  { id: "minibus-2-1", name: "Minibus 2+1", rows: 6, pattern: [true, true, false, true] },
];

export function seatsPerRow(model: BusModel): number {
  return model.pattern.filter(Boolean).length;
}

export function capacity(model: BusModel): number {
  return model.rows * seatsPerRow(model);
}

/** Plan du bus rangée par rangée, sièges numérotés de gauche à droite puis d'avant en arrière. */
export function seatMap(model: BusModel): Cell[][] {
  const first = model.pattern.indexOf(true);
  const last = model.pattern.lastIndexOf(true);
  let n = 0;
  return Array.from({ length: model.rows }, () =>
    model.pattern.map((isSeat, col): Cell => {
      if (!isSeat) return { kind: "aisle" };
      n += 1;
      return { kind: "seat", number: n, window: col === first || col === last };
    }),
  );
}

export type Segment = { from: number; to: number };
export type SeatBooking = Segment & { seat: number };

export function assertSegment({ from, to }: Segment): void {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from) {
    throw new Error(`Tronçon invalide : ${from} → ${to}`);
  }
}

export function overlaps(a: Segment, b: Segment): boolean {
  return a.from < b.to && b.from < a.to;
}

export function isSeatFree(bookings: SeatBooking[], seat: number, segment: Segment): boolean {
  assertSegment(segment);
  return !bookings.some((b) => b.seat === seat && overlaps(b, segment));
}

export function freeSeats(model: BusModel, bookings: SeatBooking[], segment: Segment): number[] {
  assertSegment(segment);
  const total = capacity(model);
  const out: number[] = [];
  for (let seat = 1; seat <= total; seat += 1) {
    if (isSeatFree(bookings, seat, segment)) out.push(seat);
  }
  return out;
}

/**
 * Placement automatique de `count` passagers : d'abord des sièges côte à côte
 * dans une même rangée (en commençant par le milieu du bus), sinon les premiers
 * sièges libres. Un passager seul est placé côté fenêtre si possible.
 * Renvoie null s'il n'y a pas assez de places.
 */
export function autoAssign(
  model: BusModel,
  bookings: SeatBooking[],
  segment: Segment,
  count: number,
): number[] | null {
  if (!Number.isInteger(count) || count < 1)
    throw new Error(`Nombre de passagers invalide : ${count}`);
  const free = new Set(freeSeats(model, bookings, segment));
  if (free.size < count) return null;

  const rows = seatMap(model);
  const middle = (rows.length - 1) / 2;
  const rowOrder = rows
    .map((_, i) => i)
    .sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle) || a - b);

  if (count === 1) {
    for (const r of rowOrder) {
      const win = rows[r]?.find((c) => c.kind === "seat" && c.window && free.has(c.number));
      if (win && win.kind === "seat") return [win.number];
    }
  }

  // Groupes de sièges contigus (sans couloir entre eux) dans une rangée.
  for (const r of rowOrder) {
    let run: number[] = [];
    for (const cell of rows[r] ?? []) {
      if (cell.kind === "seat" && free.has(cell.number)) {
        run.push(cell.number);
        if (run.length === count) return run;
      } else {
        run = [];
      }
    }
  }

  return [...free].sort((a, b) => a - b).slice(0, count);
}
