/**
 * Rôles du personnel des compagnies et ce que chacun peut faire.
 * L'interface s'en sert pour afficher les bons écrans ; la base de données
 * applique les mêmes règles (RLS), qui restent la seule vraie protection.
 */

export const MEMBER_ROLES = ["gerant", "chef_de_gare", "agent", "controleur", "comptable"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const ROLE_LABELS: Record<MemberRole, string> = {
  gerant: "Gérant",
  chef_de_gare: "Chef de gare",
  agent: "Agent de guichet",
  controleur: "Contrôleur",
  comptable: "Comptable",
};

export type Action =
  | "voir_tableau_de_bord"
  | "configurer_compagnie"
  | "gerer_tarifs"
  | "gerer_departs"
  | "annuler_depart"
  | "vendre_au_guichet"
  | "scanner_billets"
  | "voir_ventes"
  | "valider_caisse"
  | "gerer_equipe_gare"
  | "gerer_equipe"
  | "changer_compte_versement"
  | "rembourser"
  | "exporter";

const PERMISSIONS: Record<MemberRole, readonly Action[]> = {
  gerant: [
    "voir_tableau_de_bord",
    "configurer_compagnie",
    "gerer_tarifs",
    "gerer_departs",
    "annuler_depart",
    "vendre_au_guichet",
    "scanner_billets",
    "voir_ventes",
    "valider_caisse",
    "gerer_equipe_gare",
    "gerer_equipe",
    "changer_compte_versement",
    "rembourser",
    "exporter",
  ],
  chef_de_gare: [
    "voir_tableau_de_bord",
    "gerer_departs",
    "vendre_au_guichet",
    "scanner_billets",
    "voir_ventes",
    "valider_caisse",
    "gerer_equipe_gare",
  ],
  agent: ["vendre_au_guichet"],
  controleur: ["scanner_billets"],
  comptable: ["voir_tableau_de_bord", "voir_ventes", "exporter"],
};

export function can(roles: readonly MemberRole[], action: Action): boolean {
  return roles.some((role) => PERMISSIONS[role].includes(action));
}
