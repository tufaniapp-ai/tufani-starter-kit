/**
 * Ce que le téléphone du contrôleur garde pour travailler sans réseau :
 * la clé publique des billets, la liste de chaque départ, et les scans à envoyer.
 *
 * Chaque scan porte une référence unique (scan_ref) : le renvoyer deux fois
 * ne l'inscrit qu'une fois au journal.
 */

import type { ManifestTicket } from "@/domain/controle";

export type PendingScan = {
  scanRef: string;
  departureId: string;
  stationId: string;
  ticketId: string | null;
  code: string | null;
  scannedAt: string;
};

export type SavedManifest = { savedAt: string; tickets: ManifestTicket[] };

const KEY_PUBLIC = "tufani.controle.cle";
const KEY_QUEUE = "tufani.controle.scans";
const keyManifest = (departureId: string) => `tufani.controle.liste.${departureId}`;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* stockage plein ou bloqué : valable tant que la page reste ouverte */
  }
}

export const readPublicKey = () => read<string | null>(KEY_PUBLIC, null);
export const savePublicKey = (hex: string) => write(KEY_PUBLIC, hex);

export const readManifest = (departureId: string) =>
  read<SavedManifest | null>(keyManifest(departureId), null);
export const saveManifest = (departureId: string, tickets: ManifestTicket[]) =>
  write(keyManifest(departureId), { savedAt: new Date().toISOString(), tickets });

/** Marque un billet comme monté sur ce téléphone (ajouté s'il manquait à la liste). */
export function markBoardedLocally(departureId: string, ticket: ManifestTicket, at: string): void {
  const saved = readManifest(departureId);
  const list = saved?.tickets ?? [];
  const next = list.some((t) => t.id === ticket.id)
    ? list.map((t) =>
        t.id === ticket.id ? { ...t, status: "embarque" as const, boardedAt: at } : t,
      )
    : [...list, { ...ticket, status: "embarque" as const, boardedAt: at }];
  write(keyManifest(departureId), { savedAt: saved?.savedAt ?? at, tickets: next });
}

export const readScanQueue = () => read<PendingScan[]>(KEY_QUEUE, []);
export const enqueueScan = (scan: PendingScan) =>
  write(KEY_QUEUE, [...readScanQueue().filter((s) => s.scanRef !== scan.scanRef), scan]);
export const removeScan = (scanRef: string) =>
  write(
    KEY_QUEUE,
    readScanQueue().filter((s) => s.scanRef !== scanRef),
  );
