import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * SMS d'invitation envoyé après `invite_member`. On vérifie, sous la session de
 * l'appelant, qu'il est bien gérant de la compagnie et que l'invitation existe :
 * personne ne peut se servir de Tufani pour envoyer des SMS à n'importe qui.
 */
export const sendInviteSms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ memberId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: member } = await context.supabase
      .from("members" as never)
      .select("phone, company_id, activated_at, company:companies(name)")
      .eq("id", data.memberId)
      .maybeSingle();
    const row = member as {
      phone: string;
      company_id: string;
      activated_at: string | null;
      company: { name: string };
    } | null;
    if (!row) return { ok: false as const };

    const { data: isManager } = await context.supabase.rpc(
      "has_company_role" as never,
      {
        p_company: row.company_id,
        p_roles: ["gerant"],
      } as never,
    );
    if (isManager !== true) return { ok: false as const };

    const { getSmsProvider } = await import("@/server/sms.server");
    const name = row.company.name.normalize("NFD").replace(/[̀-ͯ]/g, "").slice(0, 40);
    const body = `Tufani : ${name} vous a ajoute a son equipe. Connectez-vous a Tufani Pro avec ce numero pour activer votre acces.`;
    const sent = await getSmsProvider().send({ to: row.phone, body });
    return { ok: sent.status === "envoye" };
  });
