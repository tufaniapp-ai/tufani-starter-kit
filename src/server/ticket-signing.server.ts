/**
 * Clé de signature des billets, dérivée d'un secret serveur.
 * Tant qu'aucun secret dédié (TICKET_SIGNING_SECRET) n'est configuré, on dérive
 * la clé de la clé de service Supabase : elle ne quitte jamais le serveur.
 * Changer ce secret rend les QR déjà émis invalides : à faire seulement en cas de fuite.
 */

import { deriveSigningSeed, publicKeyHex, signTicket, type TicketClaims } from "@/domain/ticket-qr";

let seedPromise: Promise<Uint8Array> | null = null;

function seed(): Promise<Uint8Array> {
  const secret = process.env["TICKET_SIGNING_SECRET"] ?? process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!secret) throw new Error("Secret de signature des billets manquant");
  seedPromise ??= deriveSigningSeed(secret);
  return seedPromise;
}

export async function ticketPublicKey(): Promise<string> {
  return publicKeyHex(await seed());
}

export async function signTicketClaims(claims: TicketClaims): Promise<string> {
  return signTicket(claims, await seed());
}
