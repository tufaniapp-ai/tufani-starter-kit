/**
 * Connexion par numéro de téléphone et code SMS.
 *
 * 1. `sendLoginCode` : vérifie les limites, enregistre l'empreinte du code, envoie le SMS.
 * 2. `checkLoginCode` : vérifie le code, crée le compte au premier passage, puis renvoie
 *    un jeton à usage unique que le navigateur échange contre une session Supabase.
 *
 * Seul ce fichier serveur voit la clé de service ; les codes ne quittent jamais le serveur.
 */

import {
  CODE_TTL_MINUTES,
  MAX_ATTEMPTS,
  TEST_CODE,
  checkRateLimit,
  generateCode,
  hashCode,
  internalEmail,
  isTestPhone,
  loginSms,
  sameHash,
} from "@/domain/login-code";
import { normalizeMaliPhone } from "@/domain/phone";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

import { getSmsProvider } from "./sms.server";

export type SendCodeResult =
  | { ok: true; phone: string; test: boolean }
  | {
      ok: false;
      error:
        "numero_invalide" | "trop_de_demandes_heure" | "trop_de_demandes_jour" | "envoi_impossible";
    };

export type CheckCodeResult =
  | { ok: true; tokenHash: string; email: string }
  | {
      ok: false;
      error:
        | "numero_invalide"
        | "code_invalide"
        | "code_expire"
        | "trop_d_essais"
        | "connexion_impossible";
    };

function secret(): string {
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY manquant");
  return key;
}

/** Les numéros de test ne marchent que tant qu'aucun vrai fournisseur de SMS n'est branché. */
function testLoginsAllowed(): boolean {
  return getSmsProvider().name === "simulateur";
}

// Les tables de cette migration ne sont pas encore dans les types générés par Lovable.
const codes = () =>
  supabaseAdmin.from("login_codes" as never) as unknown as ReturnType<typeof supabaseAdmin.from>;

export async function sendLoginCode(rawPhone: string): Promise<SendCodeResult> {
  const phone = normalizeMaliPhone(rawPhone);
  if (!phone) return { ok: false, error: "numero_invalide" };
  const test = isTestPhone(phone) && testLoginsAllowed();

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recent, error: readError } = await codes()
    .select("created_at")
    .eq("phone", phone)
    .gte("created_at", since);
  if (readError) return { ok: false, error: "envoi_impossible" };

  if (!test) {
    const sentAt = ((recent ?? []) as { created_at: string }[]).map((r) => new Date(r.created_at));
    const limit = checkRateLimit(sentAt, new Date());
    if (!limit.ok)
      return {
        ok: false,
        error: limit.reason === "heure" ? "trop_de_demandes_heure" : "trop_de_demandes_jour",
      };
  }

  const code = test ? TEST_CODE : generateCode();
  const { error: insertError } = await codes().insert({
    phone,
    code_hash: await hashCode(phone, code, secret()),
    expires_at: new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString(),
  } as never);
  if (insertError) return { ok: false, error: "envoi_impossible" };

  if (!test) {
    const sent = await getSmsProvider().send({ to: phone, body: loginSms(code) });
    if (sent.status !== "envoye") return { ok: false, error: "envoi_impossible" };
  }
  return { ok: true, phone, test };
}

type CodeRow = { id: string; code_hash: string; expires_at: string; attempts: number };

export async function checkLoginCode(rawPhone: string, code: string): Promise<CheckCodeResult> {
  const phone = normalizeMaliPhone(rawPhone);
  if (!phone) return { ok: false, error: "numero_invalide" };

  const { data, error } = await codes()
    .select("id, code_hash, expires_at, attempts")
    .eq("phone", phone)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const row = ((data ?? []) as CodeRow[])[0];
  if (error || !row) return { ok: false, error: "code_invalide" };
  if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, error: "code_expire" };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, error: "trop_d_essais" };

  const expected = await hashCode(phone, code.trim(), secret());
  if (!sameHash(expected, row.code_hash)) {
    await codes()
      .update({ attempts: row.attempts + 1 } as never)
      .eq("id", row.id);
    return {
      ok: false,
      error: row.attempts + 1 >= MAX_ATTEMPTS ? "trop_d_essais" : "code_invalide",
    };
  }
  await codes()
    .update({ consumed_at: new Date().toISOString() } as never)
    .eq("id", row.id);

  // Premier passage : création du compte, numéro déjà vérifié par le code.
  const email = internalEmail(phone);
  const created = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
    phone: phone.replace(/\D/g, ""),
    phone_confirm: true,
  });
  if (created.error && created.error.code !== "email_exists") {
    console.error("[login] création du compte impossible", created.error.message);
    return { ok: false, error: "connexion_impossible" };
  }

  const link = await supabaseAdmin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link.data?.properties?.hashed_token;
  if (link.error || !tokenHash) {
    console.error("[login] jeton de session impossible", link.error?.message);
    return { ok: false, error: "connexion_impossible" };
  }
  return { ok: true, tokenHash, email };
}
