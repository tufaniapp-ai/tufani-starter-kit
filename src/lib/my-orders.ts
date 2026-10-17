/**
 * Commandes passées depuis ce téléphone, pour retrouver ses billets sans compte.
 * Seul le lien (identifiant + clé) est gardé ; le contenu est relu sur le serveur.
 */

export type SavedOrder = { id: string; key: string; label: string; leavesAt: string };

const KEY = "tufani.mes-billets";

export function readMyOrders(): SavedOrder[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SavedOrder[]) : [];
  } catch {
    return [];
  }
}

export function rememberOrder(order: SavedOrder): void {
  try {
    const list = [order, ...readMyOrders().filter((o) => o.id !== order.id)].slice(0, 20);
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* le billet reste accessible par SMS */
  }
}
