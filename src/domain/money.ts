/** Montants en francs CFA (XOF). Toujours des entiers : le franc CFA n'a pas de centimes. */

const groupThousands = (n: number) => String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/** 6000 → "6 000 FCFA" ; -2000 → "−2 000 FCFA". Espaces normaux pour rester lisible dans un SMS. */
export function formatFcfa(amount: number, unit: "FCFA" | "F" = "FCFA"): string {
  if (!Number.isInteger(amount)) throw new Error(`Montant non entier : ${amount}`);
  const sign = amount < 0 ? "−" : "";
  return `${sign}${groupThousands(amount)} ${unit}`;
}

/** Parité fixe : 1 € = 655,957 FCFA. Sert à afficher un prix indicatif à la diaspora. */
export const XOF_PER_EUR = 655.957;

export function fcfaToEur(amount: number): number {
  return Math.round((amount / XOF_PER_EUR) * 100) / 100;
}
