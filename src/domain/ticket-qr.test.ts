import { describe, expect, it } from "vitest";

import {
  deriveSigningSeed,
  publicKeyHex,
  signTicket,
  verifyTicketQr,
  type TicketClaims,
} from "./ticket-qr";

const claims: TicketClaims = {
  ticketId: "d425fe68-73d2-419c-817e-185345d6bd22",
  departureId: "0b7c1d2e-1111-4222-8333-444455556666",
  seat: 21,
  from: 0,
  to: 1,
  code: "TFN-K8RLJ8",
};

describe("QR signé", () => {
  it("accepte un QR intact", async () => {
    const seed = await deriveSigningSeed("secret-serveur");
    const qr = await signTicket(claims, seed);
    const result = await verifyTicketQr(qr, await publicKeyHex(seed));
    expect(result).toEqual({ ok: true, claims });
  });

  it("refuse un QR modifié (autre siège)", async () => {
    const seed = await deriveSigningSeed("secret-serveur");
    const qr = await signTicket(claims, seed);
    const forged = qr.replace("|21|", "|22|");
    expect(await verifyTicketQr(forged, await publicKeyHex(seed))).toEqual({
      ok: false,
      reason: "signature",
    });
  });

  it("refuse un QR signé avec une autre clé", async () => {
    const qr = await signTicket(claims, await deriveSigningSeed("pirate"));
    const pub = await publicKeyHex(await deriveSigningSeed("secret-serveur"));
    expect(await verifyTicketQr(qr, pub)).toEqual({ ok: false, reason: "signature" });
  });

  it("refuse ce qui n'est pas un billet Tufani", async () => {
    const pub = await publicKeyHex(await deriveSigningSeed("secret-serveur"));
    expect(await verifyTicketQr("https://exemple.com", pub)).toEqual({
      ok: false,
      reason: "format",
    });
    expect(await verifyTicketQr("TFN1|a|b|x|0|1|TFN-AAAAAA|sig", pub)).toEqual({
      ok: false,
      reason: "format",
    });
  });

  it("dérive toujours la même clé du même secret", async () => {
    const a = await publicKeyHex(await deriveSigningSeed("s"));
    const b = await publicKeyHex(await deriveSigningSeed("s"));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("SMS du billet", () => {
  it("tient en 160 caractères sans accents", async () => {
    const { ticketSms } = await import("./ticket-sms");
    const sms = ticketSms({
      company: "Société des Transports Djoliba du Sahel",
      from: "Ségou",
      to: "Mopti (Sévaré)",
      date: "2026-10-17",
      time: "06:00",
      minutes: 210,
      seat: 21,
      code: "TFN-K8RLJ8",
    });
    expect(sms.length).toBeLessThanOrEqual(160);
    expect(sms).toContain("TFN-K8RLJ8");
    expect(sms).toContain("17/10 09:30");
    expect(sms).not.toMatch(/[éè]/);
  });
});
