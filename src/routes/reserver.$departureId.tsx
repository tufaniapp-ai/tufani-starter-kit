import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { Choice, Notice, inputClass } from "@/components/pro/ui";
import { PublicShell } from "@/components/PublicShell";
import { SeatPicker } from "@/components/SeatPicker";
import { Button } from "@/components/ui/button";
import {
  HOLD_MINUTES,
  MAX_ONLINE_PASSENGERS,
  maliDay,
  maliTime,
  parsePattern,
  serviceFee,
  travelTime,
  type OnlineMethod,
} from "@/domain/booking";
import { dayLabel } from "@/domain/guichet";
import { formatFcfa } from "@/domain/money";
import { normalizeMaliPhone } from "@/domain/phone";
import { autoAssign, type BusModel } from "@/domain/seats";
import { db } from "@/lib/db";
import { rememberOrder } from "@/lib/my-orders";
import { startOrder } from "@/lib/orders.functions";

type Search = { de: number; a: number };

export const Route = createFileRoute("/reserver/$departureId")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    de: Number.isInteger(Number(s["de"])) ? Number(s["de"]) : 0,
    a: Number.isInteger(Number(s["a"])) ? Number(s["a"]) : 1,
  }),
  head: () => ({
    meta: [{ title: "Réserver — Tufani" }, { name: "robots", content: "noindex" }],
  }),
  component: Reserver,
});

type TripSeats = {
  departure_id: string;
  company: string;
  route: string;
  from_pos: number;
  to_pos: number;
  from_city: string;
  to_city: string;
  from_station: string;
  to_station: string;
  leaves_at: string;
  arrives_at: string;
  price: number;
  open: boolean;
  model: { name: string; rows: number; pattern: string; capacity: number };
  taken: number[];
};

const METHODS: { key: OnlineMethod; label: string }[] = [
  { key: "orange_money", label: "Orange Money" },
  { key: "wave", label: "Wave" },
  { key: "moov_money", label: "Moov Money" },
];

type Passenger = { name: string; phone: string };

function Reserver() {
  const { departureId } = Route.useParams();
  const { de, a } = Route.useSearch();
  const navigate = useNavigate();
  const [trip, setTrip] = useState<TripSeats | null | undefined>(undefined);
  const [count, setCount] = useState(1);
  const [seats, setSeats] = useState<number[]>([]);
  const [passengers, setPassengers] = useState<Passenger[]>([{ name: "", phone: "" }]);
  const [buyer, setBuyer] = useState("");
  const [method, setMethod] = useState<OnlineMethod>("orange_money");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: e } = await db.rpc("trip_seats", {
      p_departure: departureId,
      p_from: de,
      p_to: a,
    });
    if (e) throw e;
    const t = (data ?? null) as TripSeats | null;
    setTrip(t);
    return t;
  }, [departureId, de, a]);

  useEffect(() => {
    void load().catch(() => setTrip(null));
  }, [load]);

  const model: Pick<BusModel, "rows" | "pattern"> | null = useMemo(
    () => (trip ? { rows: trip.model.rows, pattern: parsePattern(trip.model.pattern) } : null),
    [trip],
  );
  const bookings = useMemo(
    () => (trip ? trip.taken.map((seat) => ({ seat, from: 0, to: 1 })) : []),
    [trip],
  );
  const free = useMemo(() => {
    if (!trip) return new Set<number>();
    const taken = new Set(trip.taken);
    return new Set(
      Array.from({ length: trip.model.capacity }, (_, i) => i + 1).filter((n) => !taken.has(n)),
    );
  }, [trip]);

  // Places proposées d'office (côte à côte), modifiables sur le plan.
  useEffect(() => {
    if (!trip || !model) return;
    const auto = autoAssign({ id: "", name: "", ...model }, bookings, { from: 0, to: 1 }, count);
    setSeats(auto ?? []);
    setPassengers((list) =>
      Array.from({ length: count }, (_, i) => list[i] ?? { name: "", phone: "" }),
    );
  }, [trip, model, bookings, count]);

  function toggleSeat(n: number) {
    setSeats((list) => {
      if (list.includes(n)) return list.filter((s) => s !== n);
      if (list.length < count) return [...list, n];
      return [...list.slice(1), n];
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!trip) return;
    if (seats.length !== count) return setError(`Choisissez ${count} siège(s) sur le plan.`);
    if (passengers.some((p) => p.name.trim().length < 2)) {
      return setError("Écrivez le nom de chaque voyageur.");
    }
    if (!normalizeMaliPhone(buyer)) {
      return setError("Numéro de paiement invalide : 8 chiffres, par exemple 76 12 34 21.");
    }
    setError(null);
    setBusy(true);
    try {
      const sorted = [...seats].sort((x, y) => x - y);
      const r = await startOrder({
        data: {
          departureId,
          from: de,
          to: a,
          buyerPhone: buyer,
          method,
          passengers: passengers.map((p, i) => ({
            name: p.name,
            phone: p.phone,
            seat: sorted[i] ?? 0,
          })),
        },
      });
      if (!r.ok) {
        if (r.error === "siege_pris") {
          await load();
          setError(
            `${r.message ?? "Un siège vient d'être pris."} Les places ont été mises à jour.`,
          );
        } else if (r.error === "paiement_indisponible") {
          setError("Le paiement est momentanément indisponible. Réessayez dans quelques minutes.");
        } else {
          setError(r.message ?? "La réservation n'a pas pu être faite.");
        }
        return;
      }
      rememberOrder({
        id: r.orderId,
        key: r.key,
        label: `${trip.from_city} → ${trip.to_city}`,
        leavesAt: trip.leaves_at,
      });
      if (r.redirectUrl) {
        window.location.href = r.redirectUrl;
        return;
      }
      await navigate({
        to: "/commande/$orderId",
        params: { orderId: r.orderId },
        search: { k: r.key },
      });
    } catch {
      setError("Pas de réseau. Vérifiez votre connexion puis réessayez.");
    } finally {
      setBusy(false);
    }
  }

  if (trip === undefined) {
    return (
      <PublicShell>
        <p className="text-muted-foreground">Chargement du bus…</p>
      </PublicShell>
    );
  }
  if (trip === null || !trip.open) {
    return (
      <PublicShell>
        <Notice>
          Ce départ n'est plus en vente en ligne. La vente ferme 30 minutes avant le départ.
        </Notice>
        <Link to="/" className="font-bold text-primary">
          Chercher un autre départ
        </Link>
      </PublicShell>
    );
  }

  const fare = trip.price * count;
  const fee = serviceFee(count);
  const total = fare + fee;
  const sorted = [...seats].sort((x, y) => x - y);

  return (
    <PublicShell>
      <div className="flex flex-col gap-1 pt-2">
        <span className="text-sm font-bold text-primary">{trip.company}</span>
        <h1 className="text-2xl font-extrabold">
          {trip.from_city} → {trip.to_city}
        </h1>
        <p className="text-sm text-muted-foreground">
          {dayLabel(maliDay(trip.leaves_at))} · départ {maliTime(trip.leaves_at)} de{" "}
          {trip.from_station} · arrivée vers {maliTime(trip.arrives_at)} (
          {travelTime(trip.leaves_at, trip.arrives_at)})
        </p>
      </div>

      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-5">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-lg font-extrabold">Combien de voyageurs ?</legend>
          <div className="flex flex-wrap gap-2">
            {Array.from(
              { length: Math.min(MAX_ONLINE_PASSENGERS, free.size) },
              (_, i) => i + 1,
            ).map((n) => (
              <Choice key={n} selected={count === n} onClick={() => setCount(n)}>
                {n}
              </Choice>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-lg font-extrabold">Vos sièges</legend>
          <p className="text-sm text-muted-foreground">
            {sorted.length === count
              ? `Siège${count > 1 ? "s" : ""} ${sorted.join(", ")}. Touchez un autre siège pour changer.`
              : `Touchez ${count - sorted.length} siège(s) libre(s) sur le plan.`}{" "}
            L'avant du bus est en haut.
          </p>
          {model && <SeatPicker model={model} free={free} chosen={seats} onToggle={toggleSeat} />}
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-lg font-extrabold">Voyageurs</legend>
          {passengers.map((p, i) => (
            <div key={i} className="grid gap-2 rounded-xl bg-secondary p-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm font-bold">
                {count > 1 ? `Voyageur ${i + 1} · siège ${sorted[i] ?? "?"}` : "Nom du voyageur"}
                <input
                  className={inputClass}
                  value={p.name}
                  autoComplete={i === 0 ? "name" : "off"}
                  placeholder="Prénom et nom"
                  onChange={(e) =>
                    setPassengers((list) =>
                      list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                    )
                  }
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-bold">
                Téléphone (facultatif)
                <input
                  className={inputClass}
                  value={p.phone}
                  inputMode="tel"
                  placeholder="Reçoit son billet par SMS"
                  onChange={(e) =>
                    setPassengers((list) =>
                      list.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)),
                    )
                  }
                />
              </label>
            </div>
          ))}
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-lg font-extrabold">Paiement</legend>
          <div className="flex flex-wrap gap-2">
            {METHODS.map((m) => (
              <Choice key={m.key} selected={method === m.key} onClick={() => setMethod(m.key)}>
                {m.label}
              </Choice>
            ))}
          </div>
          <label className="flex flex-col gap-1 text-sm font-bold">
            Numéro {METHODS.find((m) => m.key === method)?.label} qui paie
            <input
              className={inputClass}
              value={buyer}
              inputMode="tel"
              autoComplete="tel"
              placeholder="76 12 34 21"
              onChange={(e) => setBuyer(e.target.value)}
            />
          </label>
        </fieldset>

        <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4 text-sm">
          <div className="flex justify-between">
            <span>
              {count} billet{count > 1 ? "s" : ""} {trip.company}
            </span>
            <span>{formatFcfa(fare, "F")}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Frais de service Tufani</span>
            <span>{formatFcfa(fee, "F")}</span>
          </div>
          <div className="mt-1 flex justify-between text-lg font-extrabold">
            <span>Total</span>
            <span>{formatFcfa(total, "F")}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Vos sièges sont gardés {HOLD_MINUTES} minutes le temps de payer.
          </p>
        </div>

        {error && <Notice>{error}</Notice>}
        <Button type="submit" disabled={busy} className="h-14 rounded-2xl text-lg font-extrabold">
          {busy ? "Réservation…" : `Payer ${formatFcfa(total, "F")}`}
        </Button>
      </form>
    </PublicShell>
  );
}
