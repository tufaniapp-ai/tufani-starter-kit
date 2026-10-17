/**
 * Commandes en ligne : tenir les sièges, lancer le paiement, vérifier le paiement,
 * émettre les billets. Tout passe par la clé de service, côté serveur uniquement :
 * le navigateur ne peut ni créer de billet ni déclarer une commande payée.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { maliDay, maliTime, serviceFee, type OnlineMethod, type OrderView } from "@/domain/booking";
import { normalizeMaliPhone } from "@/domain/phone";
import { ticketSms } from "@/domain/ticket-sms";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

import { getPaymentProvider } from "./payments.server";
import { getSmsProvider } from "./sms.server";
import { signTicketClaims } from "./ticket-signing.server";

const admin = () => supabaseAdmin as unknown as SupabaseClient;

export type StartOrderInput = {
  departureId: string;
  from: number;
  to: number;
  buyerPhone: string;
  method: OnlineMethod;
  passengers: { name: string; phone: string; seat: number }[];
};

export type StartOrderResult =
  | { ok: true; orderId: string; key: string; redirectUrl?: string }
  | {
      ok: false;
      error:
        | "numero_invalide"
        | "siege_pris"
        | "trop_de_reservations"
        | "paiement_indisponible"
        | "refus";
      message?: string;
    };

export async function startOrder(input: StartOrderInput): Promise<StartOrderResult> {
  const buyer = normalizeMaliPhone(input.buyerPhone);
  if (!buyer) {
    return { ok: false, error: "numero_invalide", message: "Numéro de paiement invalide." };
  }
  const passengers: { name: string; phone: string | null; seat: number }[] = [];
  for (const p of input.passengers) {
    const phone = p.phone.trim() ? normalizeMaliPhone(p.phone) : null;
    if (p.phone.trim() && !phone) {
      return { ok: false, error: "numero_invalide", message: `Numéro invalide pour ${p.name}.` };
    }
    passengers.push({ name: p.name.trim(), phone, seat: p.seat });
  }
  if (new Set(passengers.map((p) => p.seat)).size !== passengers.length) {
    return { ok: false, error: "refus", message: "Un siège est choisi deux fois." };
  }

  const { data, error } = await admin().rpc("create_order", {
    p_departure: input.departureId,
    p_from: input.from,
    p_to: input.to,
    p_passengers: passengers,
    p_buyer_phone: buyer,
    p_method: input.method,
    p_service_fee: serviceFee(passengers.length),
  });
  if (error) {
    if (error.code === "TF001") return { ok: false, error: "siege_pris", message: error.message };
    if (error.code === "TF002") {
      return { ok: false, error: "trop_de_reservations", message: error.message };
    }
    return { ok: false, error: "refus", message: error.message };
  }
  const order = data as { id: string; access_key: string; amount: number };

  const provider = getPaymentProvider();
  try {
    const r = await provider.initiate({
      orderRef: order.id,
      amount: order.amount,
      method: input.method,
      payerPhone: buyer,
    });
    await admin().rpc("set_order_payment", {
      p_order: order.id,
      p_provider: provider.name,
      p_ref: r.providerRef,
    });
    return r.redirectUrl
      ? { ok: true, orderId: order.id, key: order.access_key, redirectUrl: r.redirectUrl }
      : { ok: true, orderId: order.id, key: order.access_key };
  } catch {
    await admin().rpc("settle_order", { p_order: order.id, p_status: "echouee" });
    return { ok: false, error: "paiement_indisponible" };
  }
}

type OrderRow = {
  id: string;
  access_key: string;
  status: string;
  amount: number;
  provider_ref: string | null;
  hold_until: string;
  sms_sent_at: string | null;
};

/** Comparaison en temps constant : la clé du lien ne se devine pas caractère par caractère. */
function sameKey(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Vérifie le paiement auprès du fournisseur, règle la commande, émet QR et SMS une seule fois. */
export async function refreshOrder(orderId: string, key: string): Promise<OrderView | null> {
  const { data: row } = await admin()
    .from("orders")
    .select("id, access_key, status, amount, provider_ref, hold_until, sms_sent_at")
    .eq("id", orderId)
    .maybeSingle();
  const order = row as OrderRow | null;
  if (!order || !sameKey(order.access_key, key)) return null;

  if ((order.status === "en_attente" || order.status === "expiree") && order.provider_ref) {
    const v = await getPaymentProvider().verify(order.provider_ref);
    if (v.status === "payee" && v.amount === order.amount) {
      await admin().rpc("settle_order", { p_order: order.id, p_status: "payee" });
    } else if (v.status === "echouee") {
      await admin().rpc("settle_order", { p_order: order.id, p_status: "echouee" });
    } else if (order.status === "en_attente" && Date.parse(order.hold_until) < Date.now()) {
      await admin().rpc("settle_order", { p_order: order.id, p_status: "expiree" });
    }
  }

  const { data: viewData } = await admin().rpc("get_order", { p_order: order.id, p_key: key });
  const view = viewData as Omit<OrderView, "qrs"> | null;
  if (!view) return null;
  if (view.status !== "payee") return { ...view, qrs: {} };

  const { data: ticketRows } = await admin()
    .from("tickets")
    .select("id, departure_id, seat, from_pos, to_pos, code, passenger_phone")
    .eq("order_id", order.id);
  const tickets = (ticketRows ?? []) as {
    id: string;
    departure_id: string;
    seat: number;
    from_pos: number;
    to_pos: number;
    code: string;
    passenger_phone: string | null;
  }[];

  const qrs: Record<string, string> = {};
  for (const t of tickets) {
    qrs[t.id] = await signTicketClaims({
      ticketId: t.id,
      departureId: t.departure_id,
      seat: t.seat,
      from: t.from_pos,
      to: t.to_pos,
      code: t.code,
    });
  }

  if (!order.sms_sent_at) {
    // On marque d'abord : deux vérifications simultanées n'envoient pas deux fois les SMS.
    const { data: claimed } = await admin()
      .from("orders")
      .update({ sms_sent_at: new Date().toISOString() })
      .eq("id", order.id)
      .is("sms_sent_at", null)
      .select("id");
    if ((claimed ?? []).length > 0) {
      const sms = getSmsProvider();
      for (const t of tickets) {
        const body = ticketSms({
          company: view.company,
          from: view.from_city,
          to: view.to_city,
          date: maliDay(view.leaves_at),
          time: maliTime(view.leaves_at),
          minutes: 0,
          seat: t.seat,
          code: t.code,
        });
        await sms.send({ to: t.passenger_phone ?? view.buyer_phone, body }).catch(() => undefined);
      }
    }
  }

  return { ...view, qrs };
}
