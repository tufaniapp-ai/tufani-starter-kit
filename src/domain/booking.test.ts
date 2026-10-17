import { describe, expect, it } from "vitest";

import {
  SERVICE_FEE_PER_TICKET,
  displayedPrice,
  isSearchableDay,
  maliTime,
  parsePattern,
  serviceFee,
  travelTime,
} from "./booking";

describe("vente en ligne", () => {
  it("affiche le prix frais compris", () => {
    expect(displayedPrice(6000)).toBe(6000 + SERVICE_FEE_PER_TICKET);
    expect(serviceFee(3)).toBe(3 * SERVICE_FEE_PER_TICKET);
  });

  it("donne l'heure de Bamako quel que soit le fuseau", () => {
    expect(maliTime("2026-10-18T06:00:00+00:00")).toBe("06:00");
    expect(maliTime("2026-10-18T08:00:00+02:00")).toBe("06:00");
  });

  it("écrit la durée du trajet", () => {
    expect(travelTime("2026-10-18T06:00:00Z", "2026-10-18T09:30:00Z")).toBe("3 h 30");
    expect(travelTime("2026-10-18T06:00:00Z", "2026-10-18T08:00:00Z")).toBe("2 h");
    expect(travelTime("2026-10-18T06:00:00Z", "2026-10-18T06:45:00Z")).toBe("45 min");
  });

  it("lit le plan du bus", () => {
    expect(parsePattern("11011")).toEqual([true, true, false, true, true]);
  });

  it("limite la recherche à 60 jours", () => {
    expect(isSearchableDay("2026-10-17", "2026-10-17")).toBe(true);
    expect(isSearchableDay("2026-12-16", "2026-10-17")).toBe(true);
    expect(isSearchableDay("2026-12-17", "2026-10-17")).toBe(false);
    expect(isSearchableDay("2026-10-16", "2026-10-17")).toBe(false);
    expect(isSearchableDay("demain", "2026-10-17")).toBe(false);
  });
});
