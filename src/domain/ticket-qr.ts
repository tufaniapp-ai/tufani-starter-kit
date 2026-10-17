/**
 * QR code des billets, signé par Tufani.
 *
 * Le QR contient les données du billet et une signature Ed25519. Le téléphone du
 * contrôleur vérifie la signature avec la clé publique, sans réseau : un QR
 * copié et modifié, ou fabriqué, est refusé. La clé privée ne quitte jamais le serveur.
 *
 * Format : TFN1|<billet>|<départ>|<siège>|<de>|<à>|<code>|<signature>
 */

import * as ed from "@noble/ed25519";

export type TicketClaims = {
  ticketId: string;
  departureId: string;
  seat: number;
  from: number;
  to: number;
  code: string;
};

const PREFIX = "TFN1";

export function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array {
  const b64 = text
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(text.length / 4) * 4, "=");
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex: string): Uint8Array {
  if (!/^([0-9a-f]{2})+$/i.test(hex)) throw new Error("Clé illisible");
  return Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
}

/** Les données signées : tout sauf la signature. */
export function claimsText(c: TicketClaims): string {
  return [PREFIX, c.ticketId, c.departureId, c.seat, c.from, c.to, c.code].join("|");
}

/** Clé privée de 32 octets dérivée d'un secret serveur (stable tant que le secret ne change pas). */
export async function deriveSigningSeed(secret: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`tufani-billets-v1:${secret}`),
  );
  return new Uint8Array(digest);
}

export async function publicKeyHex(seed: Uint8Array): Promise<string> {
  return toHex(await ed.getPublicKeyAsync(seed));
}

export async function signTicket(c: TicketClaims, seed: Uint8Array): Promise<string> {
  const text = claimsText(c);
  const sig = await ed.signAsync(new TextEncoder().encode(text), seed);
  return `${text}|${toBase64Url(sig)}`;
}

export type VerifyResult =
  { ok: true; claims: TicketClaims } | { ok: false; reason: "format" | "signature" };

/** Lit un QR et vérifie sa signature avec la clé publique (hexadécimale). */
export async function verifyTicketQr(qr: string, publicKey: string): Promise<VerifyResult> {
  const parts = qr.trim().split("|");
  if (parts.length !== 8 || parts[0] !== PREFIX) return { ok: false, reason: "format" };
  const [, ticketId = "", departureId = "", seat = "", from = "", to = "", code = "", sig = ""] =
    parts;
  const claims: TicketClaims = {
    ticketId,
    departureId,
    seat: Number(seat),
    from: Number(from),
    to: Number(to),
    code,
  };
  if (
    ![claims.seat, claims.from, claims.to].every(Number.isInteger) ||
    !/^TFN-[A-Z0-9]{6}$/.test(code)
  ) {
    return { ok: false, reason: "format" };
  }
  try {
    const valid = await ed.verifyAsync(
      fromBase64Url(sig),
      new TextEncoder().encode(claimsText(claims)),
      fromHex(publicKey),
    );
    return valid ? { ok: true, claims } : { ok: false, reason: "signature" };
  } catch {
    return { ok: false, reason: "signature" };
  }
}
