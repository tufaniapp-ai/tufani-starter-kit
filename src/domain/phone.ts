/**
 * Numéros maliens : indicatif +223 suivi de 8 chiffres.
 * Le numéro est l'identité du voyageur et du personnel, il doit donc avoir une seule forme en base.
 */

export const MALI_PREFIX = "+223";

/** Accepte « 76 12 34 21 », « 0022376123421 », « +223 76-12-34-21 »… et renvoie « +22376123421 », ou null. */
export function normalizeMaliPhone(input: string): string | null {
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith("00223")) digits = digits.slice(5);
  else if (digits.startsWith("223") && digits.length === 11) digits = digits.slice(3);
  if (digits.length !== 8) return null;
  return `${MALI_PREFIX}${digits}`;
}

/** « +22376123421 » → « 76 •• •• 21 », pour les écrans où le numéro complet n'est pas nécessaire. */
export function maskPhone(e164: string): string {
  const local = e164.replace(/\D/g, "").slice(-8);
  if (local.length !== 8) return "•• •• •• ••";
  return `${local.slice(0, 2)} •• •• ${local.slice(6)}`;
}

/** « +22376123421 » → « 76 12 34 21 ». */
export function formatLocalPhone(e164: string): string {
  const local = e164.replace(/\D/g, "").slice(-8);
  return local.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
}
