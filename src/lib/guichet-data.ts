/**
 * Chargement des données du guichet, sous la session de l'agent (RLS).
 */

import type { MemberRole } from "@/domain/roles";
import type { BusModel } from "@/domain/seats";
import type { RouteStop, SoldTicket } from "@/domain/guichet";
import { supabase } from "@/integrations/supabase/client";
import { db } from "@/lib/db";

export const SELLER_ROLES: MemberRole[] = ["gerant", "chef_de_gare", "agent"];
export const SCANNER_ROLES: MemberRole[] = ["gerant", "chef_de_gare", "controleur"];

export type StaffMembership = {
  id: string;
  company_id: string;
  roles: MemberRole[];
  all_stations: boolean;
  company: { id: string; name: string };
  member_stations: { station_id: string }[];
};

export type Station = { id: string; name: string; city: string };

export type GuichetDeparture = {
  id: string;
  departure_date: string;
  departure_time: string;
  status: "prevu" | "embarquement" | "parti" | "annule";
  route: { id: string; name: string; sell_segments: boolean };
  stops: RouteStop[];
  model: BusModel & { capacity: number };
  fares: { from: number; to: number; price: number }[];
  tickets: (SoldTicket & {
    id: string;
    boardedAt: string | null;
    name: string;
    code: string;
    payment: string;
    stationId: string | null;
  })[];
};

export async function loadStaff(roles: MemberRole[] = SELLER_ROLES): Promise<{
  userId: string;
  phone: string | null;
  memberships: StaffMembership[];
} | null> {
  const { data: auth, error } = await supabase.auth.getUser();
  if (error && error.name !== "AuthSessionMissingError") throw error;
  if (!auth.user) return null;
  const { data, error: membersError } = await db
    .from("members")
    .select(
      "id, company_id, roles, all_stations, company:companies(id, name), member_stations(station_id)",
    )
    .eq("user_id", auth.user.id)
    .eq("active", true);
  if (membersError) throw membersError;
  const memberships = ((data ?? []) as unknown as StaffMembership[]).filter((m) =>
    m.roles.some((r) => roles.includes(r)),
  );
  return {
    userId: auth.user.id,
    phone: auth.user.phone ? `+${auth.user.phone}` : null,
    memberships,
  };
}

export async function loadStations(m: StaffMembership): Promise<Station[]> {
  const { data, error } = await db
    .from("stations")
    .select("id, name, city")
    .eq("company_id", m.company_id)
    .eq("active", true)
    .order("city");
  if (error) throw error;
  const all = (data ?? []) as Station[];
  if (m.all_stations) return all;
  const mine = new Set(m.member_stations.map((s) => s.station_id));
  return all.filter((s) => mine.has(s.id));
}

type DepartureRow = {
  id: string;
  departure_date: string;
  departure_time: string;
  status: GuichetDeparture["status"];
  route: {
    id: string;
    name: string;
    sell_segments: boolean;
    route_stops: {
      position: number;
      minutes: number;
      station_id: string;
      station: { city: string };
    }[];
    fares: { from_pos: number; to_pos: number; price: number }[];
  };
  model: { id: string; name: string; seat_rows: number; pattern: string; capacity: number };
};

type TicketRow = {
  id: string;
  boarded_at: string | null;
  departure_id: string;
  seat: number;
  from_pos: number;
  to_pos: number;
  status: SoldTicket["status"];
  passenger_name: string;
  code: string;
  payment_method: string;
  station_id: string | null;
};

/** Départs du jour qui passent par la gare (on peut y monter), avec sièges vendus et prix. */
export async function loadDepartures(
  companyId: string,
  day: string,
  stationId: string,
): Promise<GuichetDeparture[]> {
  await db.rpc("generate_departures", { p_company: companyId, p_days: 7 });
  const { data, error } = await db
    .from("departures")
    .select(
      "id, departure_date, departure_time, status, route:routes(id, name, sell_segments, route_stops(position, minutes, station_id, station:stations(city)), fares(from_pos, to_pos, price)), model:bus_models(id, name, seat_rows, pattern, capacity)",
    )
    .eq("company_id", companyId)
    .eq("departure_date", day)
    .neq("status", "annule")
    .order("departure_time");
  if (error) throw error;
  const rows = (data ?? []) as unknown as DepartureRow[];
  const usable = rows.filter((r) => {
    const last = Math.max(...r.route.route_stops.map((s) => s.position));
    return r.route.route_stops.some((s) => s.station_id === stationId && s.position < last);
  });
  const ids = usable.map((r) => r.id);
  const tickets: TicketRow[] = [];
  if (ids.length > 0) {
    const t = await db
      .from("tickets")
      .select(
        "id, boarded_at, departure_id, seat, from_pos, to_pos, status, passenger_name, code, payment_method, station_id",
      )
      .in("departure_id", ids);
    if (t.error) throw t.error;
    tickets.push(...((t.data ?? []) as TicketRow[]));
  }
  return usable.map((r) => ({
    id: r.id,
    departure_date: r.departure_date,
    departure_time: r.departure_time.slice(0, 5),
    status: r.status,
    route: { id: r.route.id, name: r.route.name, sell_segments: r.route.sell_segments },
    stops: r.route.route_stops
      .map((s) => ({
        position: s.position,
        stationId: s.station_id,
        city: s.station.city,
        minutes: s.minutes,
      }))
      .sort((a, b) => a.position - b.position),
    model: {
      id: r.model.id,
      name: r.model.name,
      rows: r.model.seat_rows,
      pattern: [...r.model.pattern].map((c) => c === "1"),
      capacity: r.model.capacity,
    },
    fares: r.route.fares.map((f) => ({ from: f.from_pos, to: f.to_pos, price: f.price })),
    tickets: tickets
      .filter((t) => t.departure_id === r.id)
      .map((t) => ({
        id: t.id,
        boardedAt: t.boarded_at,
        seat: t.seat,
        from: t.from_pos,
        to: t.to_pos,
        status: t.status,
        name: t.passenger_name,
        code: t.code,
        payment: t.payment_method,
        stationId: t.station_id,
      })),
  }));
}

/** Ventes de l'agent connecté aujourd'hui (caisse). */
export async function loadMySales(userId: string, day: string) {
  const { data, error } = await db
    .from("tickets")
    .select("price, payment_method, status")
    .eq("sold_by", userId)
    .gte("created_at", `${day}T00:00:00Z`)
    .lt("created_at", `${day}T23:59:59.999Z`);
  if (error) throw error;
  return (data ?? []) as { price: number; payment_method: string; status: string }[];
}
