import { describe, expect, it } from "vitest";

import { fcfaToEur, formatFcfa } from "./money";
import { formatLocalPhone, maskPhone, normalizeMaliPhone } from "./phone";
import { can } from "./roles";
import {
  BUS_MODELS,
  autoAssign,
  capacity,
  freeSeats,
  isSeatFree,
  seatMap,
  type SeatBooking,
} from "./seats";

const standard = BUS_MODELS.find((m) => m.id === "standard-2-2")!;
const confort = BUS_MODELS.find((m) => m.id === "confort-2-1")!;

describe("money", () => {
  it("formate les francs CFA avec des espaces", () => {
    expect(formatFcfa(6000)).toBe("6 000 FCFA");
    expect(formatFcfa(12500, "F")).toBe("12 500 F");
    expect(formatFcfa(-2000)).toBe("−2 000 FCFA");
    expect(formatFcfa(0)).toBe("0 FCFA");
  });

  it("refuse les montants non entiers", () => {
    expect(() => formatFcfa(10.5)).toThrow();
  });

  it("convertit en euros à la parité fixe", () => {
    expect(fcfaToEur(655957)).toBe(1000);
  });
});

describe("phone", () => {
  it("normalise les écritures courantes d'un numéro malien", () => {
    expect(normalizeMaliPhone("76 12 34 21")).toBe("+22376123421");
    expect(normalizeMaliPhone("+223 76-12-34-21")).toBe("+22376123421");
    expect(normalizeMaliPhone("0022376123421")).toBe("+22376123421");
    expect(normalizeMaliPhone("22376123421")).toBe("+22376123421");
  });

  it("rejette les numéros incomplets", () => {
    expect(normalizeMaliPhone("7612342")).toBeNull();
    expect(normalizeMaliPhone("")).toBeNull();
  });

  it("masque et formate", () => {
    expect(maskPhone("+22376123421")).toBe("76 •• •• 21");
    expect(formatLocalPhone("+22376123421")).toBe("76 12 34 21");
  });
});

describe("seats", () => {
  it("numérote les sièges et repère les fenêtres", () => {
    expect(capacity(standard)).toBe(44);
    expect(capacity(confort)).toBe(33);
    const firstRow = seatMap(standard)[0] ?? [];
    expect(firstRow.map((c) => (c.kind === "seat" ? c.number : "|"))).toEqual([1, 2, "|", 3, 4]);
    expect(
      firstRow
        .filter((c) => c.kind === "seat" && c.window)
        .map((c) => c.kind === "seat" && c.number),
    ).toEqual([1, 4]);
  });

  // Ligne Bamako(0) → Ségou(1) → San(2) → Mopti(3)
  const bookings: SeatBooking[] = [{ seat: 5, from: 0, to: 1 }];

  it("libère le siège après la descente du passager", () => {
    expect(isSeatFree(bookings, 5, { from: 1, to: 3 })).toBe(true);
    expect(isSeatFree(bookings, 5, { from: 0, to: 2 })).toBe(false);
  });

  it("refuse les tronçons invalides", () => {
    expect(() => isSeatFree(bookings, 5, { from: 2, to: 2 })).toThrow();
    expect(() => isSeatFree(bookings, 5, { from: 3, to: 1 })).toThrow();
  });

  it("compte les sièges libres sur un tronçon", () => {
    expect(freeSeats(standard, bookings, { from: 0, to: 3 })).toHaveLength(43);
    expect(freeSeats(standard, bookings, { from: 1, to: 3 })).toHaveLength(44);
  });

  it("place un passager seul côté fenêtre, au milieu du bus", () => {
    const [seat] = autoAssign(standard, [], { from: 0, to: 1 }, 1)!;
    const cell = seatMap(standard)
      .flat()
      .find((c) => c.kind === "seat" && c.number === seat);
    expect(cell).toMatchObject({ kind: "seat", window: true });
    expect(seat).toBeGreaterThan(8);
    expect(seat).toBeLessThan(37);
  });

  it("place une famille côte à côte, sans couloir entre eux", () => {
    const seats = autoAssign(standard, [], { from: 0, to: 1 }, 2)!;
    expect(seats).toHaveLength(2);
    const [a = 0, b = 0] = seats;
    expect(b - a).toBe(1);
    expect(a % 2).toBe(1); // 1-2 ou 3-4 dans la rangée, jamais 2-3
  });

  it("renvoie null quand le bus est complet", () => {
    const full: SeatBooking[] = Array.from({ length: 33 }, (_, i) => ({
      seat: i + 1,
      from: 0,
      to: 3,
    }));
    expect(autoAssign(confort, full, { from: 1, to: 2 }, 1)).toBeNull();
  });
});

describe("roles", () => {
  it("donne à chaque rôle ses seules actions", () => {
    expect(can(["agent"], "vendre_au_guichet")).toBe(true);
    expect(can(["agent"], "annuler_depart")).toBe(false);
    expect(can(["controleur"], "vendre_au_guichet")).toBe(false);
    expect(can(["chef_de_gare"], "valider_caisse")).toBe(true);
    expect(can(["chef_de_gare"], "changer_compte_versement")).toBe(false);
    expect(can(["comptable", "controleur"], "exporter")).toBe(true);
  });
});
