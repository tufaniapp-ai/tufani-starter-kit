import { describe, expect, it } from "vitest";

import { decideScan, normalizeCode, type ManifestTicket } from "./controle";

const dep = "dep-1";
const base: ManifestTicket = {
  id: "t1",
  code: "TFN-AAAAAA",
  seat: 21,
  name: "Awa",
  from: 0,
  to: 1,
  status: "valide",
  boardedAt: null,
};
const claims = { ticketId: "t1", departureId: dep, seat: 21, from: 0, to: 1, code: "TFN-AAAAAA" };

describe("décision du contrôleur", () => {
  it("laisse monter un billet valide", () => {
    expect(decideScan({ claims }, dep, [base])).toMatchObject({ kind: "ok", sinceDownload: false });
  });

  it("signale un billet déjà scanné avec l'heure", () => {
    const boarded = { ...base, status: "embarque" as const, boardedAt: "2026-10-17T12:41:00Z" };
    expect(decideScan({ claims }, dep, [boarded])).toMatchObject({
      kind: "deja",
      boardedAt: "2026-10-17T12:41:00Z",
    });
  });

  it("refuse un billet annulé ou d'un autre départ", () => {
    expect(decideScan({ claims }, dep, [{ ...base, status: "annule" }]).kind).toBe("annule");
    expect(decideScan({ claims: { ...claims, departureId: "autre" } }, dep, [base]).kind).toBe(
      "autre_depart",
    );
  });

  it("accepte un billet signé vendu après le téléchargement de la liste", () => {
    expect(decideScan({ claims }, dep, [])).toMatchObject({ kind: "ok", sinceDownload: true });
  });

  it("retrouve un billet par son code saisi à la main", () => {
    expect(decideScan({ code: "tfn-aaaaaa" }, dep, [base]).kind).toBe("ok");
    expect(decideScan({ code: "TFN-ZZZZZZ" }, dep, [base])).toEqual({
      kind: "inconnu",
      code: "TFN-ZZZZZZ",
    });
  });

  it("normalise les codes saisis", () => {
    expect(normalizeCode("tfn-k8rlj8")).toBe("TFN-K8RLJ8");
    expect(normalizeCode(" K8R LJ8 ")).toBe("TFN-K8RLJ8");
    expect(normalizeCode("abc")).toBeNull();
  });
});
