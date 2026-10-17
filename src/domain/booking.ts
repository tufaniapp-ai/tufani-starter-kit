/**
 * Règles de la vente en ligne : frais de service, limites, affichage des heures.
 *
 * Le prix affiché au voyageur inclut déjà les frais de service : pas de surprise au paiement.
 */

/** Frais de service Tufani par billet, payés par le voyageur. Montant provisoire, à fixer. */
export const SERVICE_FEE_PER_TICKET = 200;

/** Passagers par commande en ligne. */
export const MAX_ONLINE_PASSENGERS = 6;

/** Durée pendant laquelle les sièges sont tenus pour un paiement. */
export const HOLD_MINUTES = 10;

export function serviceFee(passengers: number): number {
  return SERVICE_FEE_PER_TICKET * passengers;
}

/** Prix affiché d'une place : tarif de la compagnie + frais Tufani. */
export function displayedPrice(fare: number): number {
  return fare + SERVICE_FEE_PER_TICKET;
}

/** Heure de Bamako (UTC toute l'année), quel que soit le fuseau du téléphone. */
export function maliTime(iso: string): string {
  return new Date(iso).toISOString().slice(11, 16);
}

/** Jour de Bamako « 2026-10-18 ». */
export function maliDay(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/** « 3 h 30 », « 45 min ». */
export function travelTime(fromIso: string, toIso: string): string {
  const minutes = Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
}

/** Plan du bus stocké en base (« 11011 ») vers le format du domaine. */
export function parsePattern(pattern: string): boolean[] {
  return [...pattern].map((c) => c === "1");
}

export type OnlineMethod = "orange_money" | "wave" | "moov_money";

export type OrderStatus =
  "en_attente" | "payee" | "echouee" | "expiree" | "a_rembourser" | "remboursee";

/** Commande telle que le voyageur la voit (lien avec clé). */
export type OrderView = {
  id: string;
  status: OrderStatus;
  amount: number;
  fare_total: number;
  service_fee: number;
  method: OnlineMethod;
  buyer_phone: string;
  hold_until: string;
  company: string;
  service_phone: string | null;
  from_city: string;
  to_city: string;
  from_station: string;
  to_station: string;
  leaves_at: string;
  arrives_at: string;
  tickets: { id?: string; seat: number; name: string; code?: string; status?: string }[];
  /** QR signés, par identifiant de billet, une fois la commande payée. */
  qrs: Record<string, string>;
};

/** Date de recherche acceptée : aujourd'hui jusqu'à 60 jours. */
export function isSearchableDay(day: string, today: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const diff = (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000;
  return diff >= 0 && diff <= 60;
}
