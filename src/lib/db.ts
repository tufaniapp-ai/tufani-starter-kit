/**
 * Accès aux tables Tufani depuis le navigateur, sous la session de l'utilisateur :
 * la base n'autorise que ce que la RLS permet (sa compagnie, ses gares).
 *
 * Les types générés par Lovable ne connaissent pas encore les tables créées par
 * nos migrations ; on décrit ici les lignes utilisées par l'interface.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { MemberRole } from "@/domain/roles";
import { supabase } from "@/integrations/supabase/client";

export const db = supabase as unknown as SupabaseClient;

export type CompanyStatus = "en_attente" | "validee" | "suspendue";

export type CompanyRow = {
  id: string;
  name: string;
  slug: string;
  status: CompanyStatus;
  service_phone: string | null;
  created_at: string;
};

export type MemberRow = {
  id: string;
  company_id: string;
  phone: string;
  full_name: string;
  roles: MemberRole[];
  all_stations: boolean;
  active: boolean;
};

export type StationRow = {
  id: string;
  company_id: string;
  name: string;
  city: string;
  active: boolean;
};

export type Membership = MemberRow & { company: CompanyRow };
