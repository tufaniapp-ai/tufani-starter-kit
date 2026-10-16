import { describe, expect, it } from "vitest";

import {
  departuresOver,
  normalizeTime,
  refundAmount,
  sellableSegments,
  suggestFare,
} from "./setup";

describe("tronçons vendables", () => {
  it("donne tous les couples d'arrêts, ou seulement le trajet complet", () => {
    expect(sellableSegments(4, true)).toHaveLength(6);
    expect(sellableSegments(4, false)).toEqual([{ from: 0, to: 3 }]);
    expect(sellableSegments(1, true)).toEqual([]);
  });
});

describe("prix proposés", () => {
  // Bamako (0 min) → Ségou (210) → San (330) → Mopti (600)
  const stops = [
    { position: 0, minutes: 0 },
    { position: 1, minutes: 210 },
    { position: 2, minutes: 330 },
    { position: 3, minutes: 600 },
  ];
  const known = [{ from: 0, to: 3, price: 12500 }];

  it("calcule au prorata du temps de parcours, arrondi à la centaine", () => {
    expect(suggestFare(stops, known, { from: 0, to: 1 })).toBe(4400); // 12500 × 210/600 = 4375
    expect(suggestFare(stops, known, { from: 1, to: 3 })).toBe(8200); // 12500 × 390/600 = 8125
  });

  it("se rabat sur le nombre d'arrêts sans temps de parcours", () => {
    const flat = stops.map((s) => ({ ...s, minutes: 0 }));
    expect(suggestFare(flat, known, { from: 0, to: 1 })).toBe(4200); // 12500 / 3 = 4166
  });

  it("ne propose rien sans prix de référence", () => {
    expect(suggestFare(stops, [], { from: 0, to: 1 })).toBeNull();
  });
});

describe("semaine type", () => {
  it("compte les départs sur 60 jours", () => {
    const from = new Date("2026-10-15T10:00:00Z"); // jeudi
    expect(departuresOver([{ weekdays: [1, 2, 3, 4, 5, 6, 7] }], from)).toBe(60);
    expect(departuresOver([{ weekdays: [5] }], from, 7)).toBe(1); // vendredi 16
    expect(departuresOver([{ weekdays: [1] }, { weekdays: [1, 2] }], from, 7)).toBe(3);
  });

  it("accepte plusieurs écritures d'heure", () => {
    expect(normalizeTime("6:00")).toBe("06:00");
    expect(normalizeTime("07h30")).toBe("07:30");
    expect(normalizeTime("2000")).toBe("20:00");
    expect(normalizeTime("24:00")).toBeNull();
    expect(normalizeTime("abc")).toBeNull();
  });
});

describe("remboursements", () => {
  it("applique les paliers de chaque règle", () => {
    expect(refundAmount("standard", 6000, 30)).toBe(6000);
    expect(refundAmount("standard", 6000, 5)).toBe(3000);
    expect(refundAmount("souple", 6000, 3)).toBe(6000);
    expect(refundAmount("stricte", 6000, 30)).toBe(3000);
    expect(refundAmount("stricte", 6000, 1)).toBe(0);
    expect(refundAmount("souple", 6000, -1)).toBe(0);
  });
});

describe("durées", () => {
  it("lit les écritures courantes", async () => {
    const { parseDuration, formatDuration } = await import("./setup");
    expect(parseDuration("3h30")).toBe(210);
    expect(parseDuration("3 h")).toBe(180);
    expect(parseDuration("1:15")).toBe(75);
    expect(parseDuration("45")).toBe(45);
    expect(parseDuration("2h75")).toBeNull();
    expect(parseDuration("abc")).toBeNull();
    expect(formatDuration(210)).toBe("3 h 30");
    expect(formatDuration(180)).toBe("3 h");
    expect(formatDuration(45)).toBe("45 min");
  });
});
