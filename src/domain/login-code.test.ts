import { describe, expect, it } from "vitest";

import {
  CODE_LENGTH,
  checkRateLimit,
  generateCode,
  hashCode,
  internalEmail,
  isTestPhone,
  loginSms,
  sameHash,
} from "./login-code";

describe("codes de connexion", () => {
  it("génère 6 chiffres", () => {
    for (let i = 0; i < 50; i += 1) expect(generateCode()).toMatch(/^\d{6}$/);
  });

  it("ignore les octets qui biaiseraient le tirage", () => {
    const bytes = [255, 251, 250, 3, 14, 25, 36, 47, 58, 69];
    let i = 0;
    const fake = (n: number) =>
      Uint8Array.from({ length: n }, () => bytes[i++ % bytes.length] ?? 0);
    expect(generateCode(fake)).toBe("345678");
    expect(generateCode(fake)).toHaveLength(CODE_LENGTH);
  });

  it("hache le code avec le numéro et le secret", async () => {
    const a = await hashCode("+22376123421", "123456", "secret");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashCode("+22376123421", "123456", "secret")).toBe(a);
    expect(await hashCode("+22376123422", "123456", "secret")).not.toBe(a);
    expect(await hashCode("+22376123421", "123456", "autre")).not.toBe(a);
  });

  it("compare les empreintes", () => {
    expect(sameHash("abc", "abc")).toBe(true);
    expect(sameHash("abc", "abd")).toBe(false);
    expect(sameHash("abc", "abcd")).toBe(false);
  });

  it("limite à 3 codes par heure et 10 par jour", () => {
    const now = new Date("2026-10-16T12:00:00Z");
    const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
    expect(checkRateLimit([minutesAgo(5), minutesAgo(10)], now)).toEqual({ ok: true });
    expect(checkRateLimit([minutesAgo(5), minutesAgo(10), minutesAgo(50)], now)).toEqual({
      ok: false,
      reason: "heure",
    });
    const tenToday = Array.from({ length: 10 }, (_, k) => minutesAgo(90 + k * 60));
    expect(checkRateLimit(tenToday, now)).toEqual({ ok: false, reason: "jour" });
  });

  it("reconnaît les numéros de test", () => {
    expect(isTestPhone("+22300000001")).toBe(true);
    expect(isTestPhone("+22300000000")).toBe(false);
    expect(isTestPhone("+22376123421")).toBe(false);
  });

  it("tient le SMS en 160 caractères", () => {
    expect(loginSms("123456").length).toBeLessThanOrEqual(160);
  });

  it("construit une adresse interne impossible à joindre", () => {
    expect(internalEmail("+22376123421")).toBe("22376123421@telephone.tufani.invalid");
  });
});
