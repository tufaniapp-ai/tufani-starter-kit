import { describe, expect, it } from "vitest";

import {
  activeBookings,
  addMinutes,
  boardingPositions,
  cashSummary,
  dayLabel,
  destinations,
  isoDay,
} from "./guichet";

// Bamako(0) → Ségou(1) → San(2) → Mopti(3)
const stops = [
  { position: 0, stationId: "bko", city: "Bamako", minutes: 0 },
  { position: 1, stationId: "seg", city: "Ségou", minutes: 210 },
  { position: 2, stationId: "san", city: "San", minutes: 330 },
  { position: 3, stationId: "mop", city: "Mopti", minutes: 600 },
];

describe("guichet", () => {
  it("ne fait monter qu'aux arrêts de la gare, jamais au terminus", () => {
    expect(boardingPositions(stops, "seg")).toEqual([1]);
    expect(boardingPositions(stops, "mop")).toEqual([]);
    expect(boardingPositions(stops, "autre")).toEqual([]);
  });

  it("propose les arrêts suivants, ou seulement le terminus", () => {
    expect(destinations(stops, 1, true).map((s) => s.city)).toEqual(["San", "Mopti"]);
    expect(destinations(stops, 0, false).map((s) => s.city)).toEqual(["Mopti"]);
    expect(destinations(stops, 1, false)).toEqual([]);
  });

  it("libère les sièges des billets annulés", () => {
    expect(
      activeBookings([
        { seat: 1, from: 0, to: 3, status: "valide" },
        { seat: 2, from: 0, to: 3, status: "annule" },
        { seat: 3, from: 1, to: 2, status: "embarque" },
      ]),
    ).toEqual([
      { seat: 1, from: 0, to: 3 },
      { seat: 3, from: 1, to: 2 },
    ]);
  });

  it("calcule la caisse de l'agent", () => {
    expect(
      cashSummary([
        { price: 6000, payment_method: "especes", status: "valide" },
        { price: 6000, payment_method: "especes", status: "annule" },
        { price: 12500, payment_method: "orange_money", status: "valide" },
      ]),
    ).toEqual({ tickets: 2, cash: 6000, mobile: 12500, total: 18500 });
  });

  it("gère les dates et les heures", () => {
    const now = new Date("2026-10-17T22:30:00Z");
    expect(isoDay(0, now)).toBe("2026-10-17");
    expect(isoDay(1, now)).toBe("2026-10-18");
    expect(dayLabel("2026-10-17", now)).toBe("Aujourd'hui");
    expect(dayLabel("2026-10-18", now)).toBe("Demain");
    expect(addMinutes("06:00", 210)).toBe("09:30");
    expect(addMinutes("22:00", 180)).toBe("01:00");
  });
});
