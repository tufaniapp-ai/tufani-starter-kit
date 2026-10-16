import { describe, expect, it } from "vitest";

import { nextSlug, slugify } from "./slug";

describe("slugify", () => {
  it("retire accents, majuscules et ponctuation", () => {
    expect(slugify("Djoliba Trans S.A.")).toBe("djoliba-trans-s-a");
    expect(slugify("  Ségou Express — Voyages  ")).toBe("segou-express-voyages");
    expect(slugify("Niger Lines!!!")).toBe("niger-lines");
  });

  it("limite la longueur sans tiret final", () => {
    const s = slugify("a ".repeat(80));
    expect(s.length).toBeLessThanOrEqual(60);
    expect(s.endsWith("-")).toBe(false);
  });

  it("numérote les doublons", () => {
    expect(nextSlug("sahel", 1)).toBe("sahel");
    expect(nextSlug("sahel", 3)).toBe("sahel-3");
  });
});
