/**
 * Codes de connexion envoyés par SMS.
 *
 * Tufani gère lui-même ses codes (plutôt que l'envoi SMS intégré à Supabase)
 * pour pouvoir passer par n'importe quel fournisseur de SMS malien.
 * Le code n'est jamais stocké en clair : seulement son empreinte HMAC.
 */

export const CODE_LENGTH = 6;
export const CODE_TTL_MINUTES = 5;
export const MAX_ATTEMPTS = 5;
export const MAX_CODES_PER_HOUR = 3;
export const MAX_CODES_PER_DAY = 10;

/**
 * Numéros de test : +223 00 00 00 01 à 09, code fixe 123456, aucun SMS envoyé.
 * Ils ne fonctionnent que tant qu'aucun vrai fournisseur de SMS n'est branché.
 */
export const TEST_CODE = "123456";
export function isTestPhone(e164: string): boolean {
  return /^\+2230000000[1-9]$/.test(e164);
}

export function generateCode(random: (n: number) => Uint8Array = defaultRandom): string {
  // Rejet des valeurs hautes pour éviter un biais modulo.
  let out = "";
  while (out.length < CODE_LENGTH) {
    for (const byte of random(CODE_LENGTH)) {
      if (byte < 250 && out.length < CODE_LENGTH) out += String(byte % 10);
    }
  }
  return out;
}

function defaultRandom(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

export async function hashCode(phone: string, code: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${phone}:${code}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Comparaison en temps constant, pour ne rien révéler par le temps de réponse. */
export function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type RateLimitResult = { ok: true } | { ok: false; reason: "heure" | "jour" };

/** `sentAt` : dates des codes déjà envoyés à ce numéro. */
export function checkRateLimit(sentAt: Date[], now: Date): RateLimitResult {
  const hourAgo = now.getTime() - 60 * 60 * 1000;
  const dayAgo = now.getTime() - 24 * 60 * 60 * 1000;
  if (sentAt.filter((d) => d.getTime() > hourAgo).length >= MAX_CODES_PER_HOUR) {
    return { ok: false, reason: "heure" };
  }
  if (sentAt.filter((d) => d.getTime() > dayAgo).length >= MAX_CODES_PER_DAY) {
    return { ok: false, reason: "jour" };
  }
  return { ok: true };
}

/** Texte du SMS : moins de 160 caractères, sans accents pour rester à 1 crédit. */
export function loginSms(code: string): string {
  return `Tufani : votre code de connexion est ${code}. Il expire dans ${CODE_TTL_MINUTES} min. Ne le donnez a personne, meme a un agent Tufani.`;
}

/**
 * Adresse interne du compte : Supabase exige un e-mail pour ouvrir une session,
 * mais le voyageur ne le voit jamais. Domaine .invalid : aucun e-mail ne peut partir.
 */
export function internalEmail(e164: string): string {
  return `${e164.replace(/\D/g, "")}@telephone.tufani.invalid`;
}
