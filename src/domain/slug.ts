/** « Djoliba Trans S.A. » → « djoliba-trans-s-a ». Sert aux adresses publiques des compagnies. */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/** Variante suivante quand l'adresse est déjà prise : « nom », « nom-2 », « nom-3 »… */
export function nextSlug(base: string, attempt: number): string {
  return attempt <= 1 ? base : `${base}-${attempt}`;
}
