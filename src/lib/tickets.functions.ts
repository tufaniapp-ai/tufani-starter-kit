import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Clé publique des billets : les téléphones des contrôleurs la gardent pour vérifier sans réseau. */
export const getTicketPublicKey = createServerFn({ method: "GET" }).handler(async () => {
  const { ticketPublicKey } = await import("@/server/ticket-signing.server");
  return { publicKey: await ticketPublicKey() };
});

type TicketRow = {
  id: string;
  departure_id: string;
  seat: number;
  from_pos: number;
  to_pos: number;
  code: string;
  passenger_name: string;
  passenger_phone: string | null;
  departure: {
    departure_date: string;
    departure_time: string;
    company: { name: string };
    route: { route_stops: { position: number; minutes: number; station: { city: string } }[] };
  };
};

const SELECT =
  "id, departure_id, seat, from_pos, to_pos, code, passenger_name, passenger_phone, departure:departures(departure_date, departure_time, company:companies(name), route:routes(route_stops(position, minutes, station:stations(city))))";

/**
 * QR signés des billets demandés. Lus sous la session de l'appelant : on ne signe
 * que des billets qu'il a le droit de voir (RLS).
 */
export const signTickets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ ticketIds: z.array(z.string().uuid()).min(1).max(10) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("tickets" as never)
      .select(SELECT)
      .in("id", data.ticketIds);
    if (error) return { ok: false as const, tickets: [] };
    const { signTicketClaims } = await import("@/server/ticket-signing.server");
    const tickets = await Promise.all(
      ((rows ?? []) as unknown as TicketRow[]).map(async (t) => ({
        id: t.id,
        code: t.code,
        qr: await signTicketClaims({
          ticketId: t.id,
          departureId: t.departure_id,
          seat: t.seat,
          from: t.from_pos,
          to: t.to_pos,
          code: t.code,
        }),
      })),
    );
    return { ok: true as const, tickets };
  });

/** Billet envoyé par SMS au voyageur (si un numéro a été donné). */
export const sendTicketSms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ ticketIds: z.array(z.string().uuid()).min(1).max(10) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("tickets" as never)
      .select(SELECT)
      .in("id", data.ticketIds);
    if (error) return { sent: 0 };
    const { getSmsProvider } = await import("@/server/sms.server");
    const { ticketSms } = await import("@/domain/ticket-sms");
    let sent = 0;
    for (const t of (rows ?? []) as unknown as TicketRow[]) {
      if (!t.passenger_phone) continue;
      const stops = t.departure.route.route_stops;
      const body = ticketSms({
        company: t.departure.company.name,
        from: stops.find((s) => s.position === t.from_pos)?.station.city ?? "",
        to: stops.find((s) => s.position === t.to_pos)?.station.city ?? "",
        date: t.departure.departure_date,
        time: t.departure.departure_time.slice(0, 5),
        minutes: stops.find((s) => s.position === t.from_pos)?.minutes ?? 0,
        seat: t.seat,
        code: t.code,
      });
      const r = await getSmsProvider().send({ to: t.passenger_phone, body });
      if (r.status === "envoye") sent += 1;
    }
    return { sent };
  });
