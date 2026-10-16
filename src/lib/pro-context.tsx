import { createContext, useContext } from "react";

import type { Membership } from "@/lib/db";

export type SetupStatus = {
  gares: number;
  lignes: number;
  modeles: number;
  bus: number;
  horaires: number;
  troncons_sans_prix: number;
  annulation: boolean;
  equipe: number;
  versements: boolean;
};

export type ProContextValue = {
  membership: Membership;
  memberships: Membership[];
  status: SetupStatus | null;
  refreshStatus: () => Promise<void>;
  switchCompany: (companyId: string) => void;
};

export const ProContext = createContext<ProContextValue | null>(null);

export function usePro(): ProContextValue {
  const value = useContext(ProContext);
  if (!value) throw new Error("usePro doit être utilisé dans l'espace compagnie");
  return value;
}

export type StepKey =
  "gares" | "lignes" | "bus" | "horaires" | "annulation" | "equipe" | "versements";

export const STEPS: { key: StepKey; to: string; label: string }[] = [
  { key: "gares", to: "/pro/gares", label: "Gares" },
  { key: "lignes", to: "/pro/lignes", label: "Lignes et arrêts" },
  { key: "bus", to: "/pro/bus", label: "Bus" },
  { key: "horaires", to: "/pro/horaires", label: "Horaires et tarifs" },
  { key: "annulation", to: "/pro/annulation", label: "Annulation" },
  { key: "equipe", to: "/pro/equipe", label: "Équipe" },
  { key: "versements", to: "/pro/versements", label: "Versements" },
];

export function stepDone(key: StepKey, s: SetupStatus | null): boolean {
  if (!s) return false;
  switch (key) {
    case "gares":
      return s.gares >= 1;
    case "lignes":
      return s.lignes >= 1;
    case "bus":
      return s.modeles >= 1 && s.bus >= 1;
    case "horaires":
      return s.horaires >= 1 && s.troncons_sans_prix === 0 && s.lignes >= 1;
    case "annulation":
      return s.annulation;
    case "equipe":
      return s.equipe >= 2;
    case "versements":
      return s.versements;
  }
}
