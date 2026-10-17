/**
 * File d'attente des ventes faites quand le réseau coupe.
 *
 * Chaque vente porte une référence unique (sale_ref) : la renvoyer deux fois ne
 * crée jamais deux billets (la base la reconnaît). Au retour du réseau, la file
 * est rejouée dans l'ordre ; une vente refusée (siège pris entre-temps) est
 * signalée à l'agent au lieu d'être perdue.
 */

export type PendingSale = {
  saleRef: string;
  createdAt: string;
  departureId: string;
  label: string;
  from: number;
  to: number;
  stationId: string;
  payment: string;
  passengers: { name: string; phone: string | null; seat: number }[];
  total: number;
  error?: string;
};

const KEY = "tufani.guichet.file";

export function readQueue(): PendingSale[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PendingSale[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(list: PendingSale[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* stockage plein ou bloqué : la vente reste affichée tant que la page est ouverte */
  }
}

export function enqueue(sale: PendingSale): void {
  writeQueue([...readQueue().filter((s) => s.saleRef !== sale.saleRef), sale]);
}

export function removeFromQueue(saleRef: string): void {
  writeQueue(readQueue().filter((s) => s.saleRef !== saleRef));
}

export function markFailed(saleRef: string, error: string): void {
  writeQueue(readQueue().map((s) => (s.saleRef === saleRef ? { ...s, error } : s)));
}

/** Erreur de réseau (à remettre en file) plutôt que refus de la base (à montrer). */
export function isNetworkError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const message =
    error instanceof Error
      ? error.message
      : String((error as { message?: unknown })?.message ?? error);
  return /fetch|network|réseau|Failed to fetch|NetworkError|Load failed|timeout/i.test(message);
}
