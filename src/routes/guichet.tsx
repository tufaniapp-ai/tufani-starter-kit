import { Link, createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";

import { Choice, Notice, inputClass } from "@/components/pro/ui";
import { Button } from "@/components/ui/button";
import {
  activeBookings,
  addMinutes,
  cashSummary,
  dayLabel,
  destinations,
  isoDay,
  boardingPositions,
} from "@/domain/guichet";
import { formatFcfa } from "@/domain/money";
import { normalizeMaliPhone } from "@/domain/phone";
import { autoAssign, freeSeats, seatMap, type SeatBooking } from "@/domain/seats";
import { db } from "@/lib/db";
import {
  loadDepartures,
  loadMySales,
  loadStaff,
  loadStations,
  type GuichetDeparture,
  type StaffMembership,
  type Station,
} from "@/lib/guichet-data";
import {
  enqueue,
  isNetworkError,
  markFailed,
  readQueue,
  removeFromQueue,
  type PendingSale,
} from "@/lib/offline-queue";
import { cn } from "@/lib/utils";
import { SeatPicker } from "@/components/SeatPicker";
import { TicketQr } from "@/components/TicketQr";
import { sendTicketSms, signTickets } from "@/lib/tickets.functions";

export const Route = createFileRoute("/guichet")({
  head: () => ({
    meta: [{ title: "Guichet — Tufani Pro" }, { name: "robots", content: "noindex" }],
  }),
  component: Guichet,
});

const STATION_KEY = "tufani.guichet.gare";
const PAYMENTS = [
  { key: "especes", label: "Espèces" },
  { key: "orange_money", label: "Orange Money" },
  { key: "wave", label: "Wave" },
  { key: "moov_money", label: "Moov Money" },
] as const;
type Payment = (typeof PAYMENTS)[number]["key"];

type SoldResult = { id?: string; code: string | null; seat: number; price: number; name: string };
type Receipt = {
  departure: GuichetDeparture;
  from: number;
  to: number;
  payment: Payment;
  tickets: SoldResult[];
  pending: boolean;
};

function Guichet() {
  const [state, setState] = useState<"loading" | "anonymous" | "forbidden" | "error" | "ready">(
    "loading",
  );
  const [userId, setUserId] = useState("");
  const [memberships, setMemberships] = useState<StaffMembership[]>([]);
  const [membership, setMembership] = useState<StaffMembership | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [stationId, setStationId] = useState<string>("");
  const [day, setDay] = useState(isoDay(0));
  const [departures, setDepartures] = useState<GuichetDeparture[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"vente" | "liste">("vente");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [queue, setQueue] = useState<PendingSale[]>([]);
  const [online, setOnline] = useState(true);
  const [sales, setSales] = useState<{ price: number; payment_method: string; status: string }[]>(
    [],
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  // Connexion et rôles
  useEffect(() => {
    void (async () => {
      try {
        const staff = await loadStaff();
        if (!staff) return setState("anonymous");
        if (staff.memberships.length === 0) return setState("forbidden");
        setUserId(staff.userId);
        setMemberships(staff.memberships);
        setMembership(staff.memberships[0] ?? null);
        setState("ready");
      } catch {
        setState("error");
      }
    })();
  }, []);

  // Gares confiées
  useEffect(() => {
    if (!membership) return;
    void loadStations(membership)
      .then((list) => {
        setStations(list);
        let saved = "";
        try {
          saved = localStorage.getItem(STATION_KEY) ?? "";
        } catch {
          saved = "";
        }
        setStationId(list.find((s) => s.id === saved)?.id ?? list[0]?.id ?? "");
      })
      .catch(() => setLoadError("Impossible de charger vos gares."));
  }, [membership]);

  const refresh = useCallback(async () => {
    if (!membership || !stationId) return;
    try {
      const [deps, mine] = await Promise.all([
        loadDepartures(membership.company_id, day, stationId),
        loadMySales(userId, isoDay(0)),
      ]);
      setDepartures(deps);
      setSales(mine);
      setLoadError(null);
    } catch (e) {
      setLoadError(
        isNetworkError(e)
          ? "Pas de réseau : les départs affichés peuvent ne pas être à jour."
          : "Impossible de charger les départs.",
      );
    }
  }, [membership, stationId, day, userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // File hors ligne : renvoi automatique au retour du réseau
  const flush = useCallback(async () => {
    const list = readQueue().filter((s) => !s.error);
    for (const sale of list) {
      const { error } = await db.rpc("sell_tickets", {
        p_departure: sale.departureId,
        p_from: sale.from,
        p_to: sale.to,
        p_station: sale.stationId,
        p_payment: sale.payment,
        p_passengers: sale.passengers,
        p_sale_ref: sale.saleRef,
      });
      if (!error) removeFromQueue(sale.saleRef);
      else if (isNetworkError(error)) break;
      else markFailed(sale.saleRef, error.message);
    }
    setQueue(readQueue());
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setQueue(readQueue());
    setOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    const up = () => {
      setOnline(true);
      void flush();
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    const timer = setInterval(() => {
      if (navigator.onLine && readQueue().some((s) => !s.error)) void flush();
    }, 30000);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      clearInterval(timer);
    };
  }, [flush]);

  function chooseStation(id: string) {
    setStationId(id);
    setSelected(null);
    try {
      localStorage.setItem(STATION_KEY, id);
    } catch {
      /* choix valable pour cette visite */
    }
  }

  const station = stations.find((s) => s.id === stationId);
  const departure = departures?.find((d) => d.id === selected) ?? null;
  const cash = cashSummary(sales);
  const pendingCount = queue.filter((s) => !s.error).length;
  const failed = queue.filter((s) => s.error);

  if (state !== "ready") {
    return (
      <Shell>
        {state === "loading" && <p className="text-muted-foreground">Chargement…</p>}
        {state === "anonymous" && (
          <div className="flex flex-col gap-4">
            <h1 className="text-2xl font-extrabold">Guichet</h1>
            <p className="text-muted-foreground">Connectez-vous avec votre numéro pour vendre.</p>
            <Button asChild className="h-12 w-fit rounded-xl px-6 font-extrabold">
              <Link to="/connexion" search={{ suite: "/guichet" }}>
                Se connecter
              </Link>
            </Button>
          </div>
        )}
        {state === "forbidden" && (
          <Notice>
            Votre compte n'a pas accès à la vente au guichet. Demandez à votre gérant.
          </Notice>
        )}
        {state === "error" && (
          <Notice>
            Impossible de charger le guichet. Vérifiez votre connexion internet, puis rechargez la
            page.
          </Notice>
        )}
      </Shell>
    );
  }

  return (
    <Shell
      header={
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-col">
              <span className="text-lg font-extrabold">
                Guichet {station ? `· ${station.name}` : ""}
              </span>
              <span className="text-xs text-white/70">{membership?.company.name}</span>
            </div>
            <span className="rounded-full bg-highlight px-3 py-1 text-xs font-extrabold text-highlight-foreground">
              Ma caisse : {formatFcfa(cash.cash, "F")}
            </span>
          </div>
          {(!online || pendingCount > 0) && (
            <p className="rounded-lg bg-warning px-3 py-2 text-xs font-bold text-warning-foreground">
              {online ? "" : "Hors ligne · "}
              {pendingCount > 0
                ? `${pendingCount} vente(s) en attente d'envoi`
                : "les ventes seront envoyées au retour du réseau"}
            </p>
          )}
        </div>
      }
    >
      {memberships.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {memberships.map((m) => (
            <Choice key={m.id} selected={m.id === membership?.id} onClick={() => setMembership(m)}>
              {m.company.name}
            </Choice>
          ))}
        </div>
      )}

      {stations.length === 0 && (
        <Notice>Aucune gare ne vous est confiée. Demandez à votre gérant.</Notice>
      )}
      {stations.length > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Gare">
          {stations.map((s) => (
            <Choice key={s.id} selected={s.id === stationId} onClick={() => chooseStation(s.id)}>
              {s.name} · {s.city}
            </Choice>
          ))}
        </div>
      )}

      {failed.map((s) => (
        <Notice key={s.saleRef}>
          Vente non enregistrée ({s.label}, {s.passengers.map((p) => `siège ${p.seat}`).join(", ")})
          : {s.error}{" "}
          <button
            type="button"
            className="font-bold underline"
            onClick={() => {
              removeFromQueue(s.saleRef);
              setQueue(readQueue());
            }}
          >
            J'ai remboursé le voyageur
          </button>
        </Notice>
      ))}

      {receipt ? (
        <ReceiptView
          receipt={receipt}
          stationName={station?.name ?? ""}
          companyName={membership?.company.name ?? ""}
          onDone={() => setReceipt(null)}
        />
      ) : (
        <>
          <div className="flex gap-2">
            {[0, 1].map((o) => (
              <Choice
                key={o}
                selected={day === isoDay(o)}
                onClick={() => {
                  setDay(isoDay(o));
                  setSelected(null);
                }}
              >
                {dayLabel(isoDay(o))}
              </Choice>
            ))}
          </div>

          {loadError && <Notice>{loadError}</Notice>}
          {departures === null && !loadError && (
            <p className="text-sm text-muted-foreground">Chargement des départs…</p>
          )}
          {departures?.length === 0 && (
            <Notice tone="info">
              Aucun départ de cette gare {day === isoDay(0) ? "aujourd'hui" : "ce jour-là"}.
              Vérifiez la semaine type.
            </Notice>
          )}

          {departures && departures.length > 0 && (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {departures.map((d) => {
                const from = boardingPositions(d.stops, stationId)[0] ?? 0;
                const last = Math.max(...d.stops.map((s) => s.position));
                const pending = pendingBookings(queue, d.id);
                const free = freeSeats(d.model, [...activeBookings(d.tickets), ...pending], {
                  from,
                  to: last,
                }).length;
                const at = addMinutes(
                  d.departure_time,
                  d.stops.find((s) => s.position === from)?.minutes ?? 0,
                );
                const on = d.id === selected;
                return (
                  <li key={d.id}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        setSelected(d.id);
                        setView("vente");
                      }}
                      className={cn(
                        "flex min-h-20 w-full flex-col items-start gap-1 rounded-2xl p-3 text-left",
                        on ? "bg-primary text-primary-foreground" : "border-2 border-input bg-card",
                      )}
                    >
                      <span className="text-xl font-extrabold">{at}</span>
                      <span className="text-xs font-bold">{d.route.name}</span>
                      <span
                        className={cn(
                          "text-xs font-bold",
                          free <= 5 && !on && "text-warning-foreground",
                        )}
                      >
                        {free === 0 ? "Complet" : `${free} place(s)`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {departure && (
            <>
              <div className="flex gap-2">
                <Choice selected={view === "vente"} onClick={() => setView("vente")}>
                  Vendre
                </Choice>
                <Choice selected={view === "liste"} onClick={() => setView("liste")}>
                  Liste passagers
                </Choice>
              </div>
              {view === "vente" ? (
                <SaleForm
                  key={departure.id}
                  departure={departure}
                  stationId={stationId}
                  pending={pendingBookings(queue, departure.id)}
                  onSold={async (r) => {
                    setReceipt(r);
                    setQueue(readQueue());
                    await refresh();
                  }}
                />
              ) : (
                <Manifest
                  departure={departure}
                  stationId={stationId}
                  companyName={membership?.company.name ?? ""}
                />
              )}
            </>
          )}

          <section className="flex flex-wrap gap-x-6 gap-y-1 rounded-2xl bg-card p-4 text-sm">
            <span className="font-extrabold">Ma caisse aujourd'hui</span>
            <span>{cash.tickets} billet(s)</span>
            <span>Espèces à remettre : {formatFcfa(cash.cash, "F")}</span>
            <span className="text-muted-foreground">
              Mobile money : {formatFcfa(cash.mobile, "F")}
            </span>
          </section>
        </>
      )}
    </Shell>
  );
}

function pendingBookings(queue: PendingSale[], departureId: string): SeatBooking[] {
  return queue
    .filter((s) => s.departureId === departureId && !s.error)
    .flatMap((s) => s.passengers.map((p) => ({ seat: p.seat, from: s.from, to: s.to })));
}

function SaleForm({
  departure,
  stationId,
  pending,
  onSold,
}: {
  departure: GuichetDeparture;
  stationId: string;
  pending: SeatBooking[];
  onSold: (r: Receipt) => Promise<void>;
}) {
  const from = boardingPositions(departure.stops, stationId)[0] ?? 0;
  const options = destinations(departure.stops, from, departure.route.sell_segments).filter((s) =>
    departure.fares.some((f) => f.from === from && f.to === s.position),
  );
  const [to, setTo] = useState(options.at(-1)?.position ?? -1);
  const [count, setCount] = useState(1);
  const [names, setNames] = useState<string[]>([""]);
  const [phone, setPhone] = useState("");
  const [payment, setPayment] = useState<Payment>("especes");
  const [manual, setManual] = useState<number[] | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bookings = useMemo(
    () => [...activeBookings(departure.tickets), ...pending],
    [departure.tickets, pending],
  );
  const auto = useMemo(
    () => (to < 0 ? null : autoAssign(departure.model, bookings, { from, to }, count)),
    [departure.model, bookings, from, to, count],
  );
  const seats = manual && manual.length === count ? manual : auto;
  const free = useMemo(
    () => new Set(to < 0 ? [] : freeSeats(departure.model, bookings, { from, to })),
    [departure.model, bookings, from, to],
  );
  const price = departure.fares.find((f) => f.from === from && f.to === to)?.price ?? 0;
  const total = price * count;

  function setPassengers(n: number) {
    const c = Math.max(1, Math.min(10, n));
    setCount(c);
    setManual(null);
    setNames((list) => Array.from({ length: c }, (_, i) => list[i] ?? ""));
  }

  function toggleSeat(n: number) {
    const current = seats ?? [];
    if (current.includes(n)) {
      setManual(current.filter((s) => s !== n));
    } else if (current.length < count) {
      setManual([...current, n]);
    } else {
      setManual([...current.slice(1), n]);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (to < 0) return setError("Choisissez la destination.");
    if (!seats || seats.length !== count)
      return setError("Pas assez de places libres pour ce trajet.");
    if (names.some((n) => n.trim().length < 2))
      return setError("Indiquez le nom de chaque voyageur.");
    const normalized = phone.trim() ? normalizeMaliPhone(phone) : null;
    if (phone.trim() && !normalized) return setError("Numéro de téléphone invalide (8 chiffres).");

    const passengers = names.map((n, i) => ({
      name: n.trim(),
      phone: i === 0 ? normalized : null,
      seat: seats[i] ?? 0,
    }));
    const saleRef = crypto.randomUUID();
    const dest = departure.stops.find((s) => s.position === to)?.city ?? "";
    setBusy(true);
    try {
      const { data, error: rpcError } = await db.rpc("sell_tickets", {
        p_departure: departure.id,
        p_from: from,
        p_to: to,
        p_station: stationId,
        p_payment: payment,
        p_passengers: passengers,
        p_sale_ref: saleRef,
      });
      if (rpcError && !isNetworkError(rpcError)) {
        setManual(null);
        return setError(
          rpcError.code === "TF001"
            ? `${rpcError.message}. Un autre siège a été proposé, vérifiez et réessayez.`
            : rpcError.message,
        );
      }
      if (rpcError) {
        enqueue({
          saleRef,
          createdAt: new Date().toISOString(),
          departureId: departure.id,
          label: `${departure.departure_time} → ${dest}`,
          from,
          to,
          stationId,
          payment,
          passengers,
          total,
        });
        await onSold({
          departure,
          from,
          to,
          payment,
          pending: true,
          tickets: passengers.map((p) => ({ code: null, seat: p.seat, price, name: p.name })),
        });
        return;
      }
      const sold = (data ?? []) as {
        id: string;
        code: string;
        seat: number;
        price: number;
        name: string;
      }[];
      if (normalized)
        void sendTicketSms({ data: { ticketIds: sold.map((t) => t.id) } }).catch(() => undefined);
      await onSold({ departure, from, to, payment, pending: false, tickets: sold });
    } catch (err) {
      if (isNetworkError(err)) {
        enqueue({
          saleRef,
          createdAt: new Date().toISOString(),
          departureId: departure.id,
          label: `${departure.departure_time} → ${dest}`,
          from,
          to,
          stationId,
          payment,
          passengers,
          total,
        });
        await onSold({
          departure,
          from,
          to,
          payment,
          pending: true,
          tickets: passengers.map((p) => ({ code: null, seat: p.seat, price, name: p.name })),
        });
      } else {
        setError("La vente n'a pas abouti. Réessayez.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (options.length === 0) {
    return (
      <Notice tone="info">
        Aucun trajet en vente depuis cette gare sur ce départ (prix manquant ?).
      </Notice>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-2xl bg-card p-4">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-bold text-muted-foreground">Destination</span>
        <div className="flex flex-wrap gap-2">
          {options.map((s) => (
            <Choice
              key={s.position}
              selected={to === s.position}
              onClick={() => {
                setTo(s.position);
                setManual(null);
              }}
            >
              {s.city} ·{" "}
              {formatFcfa(
                departure.fares.find((f) => f.from === from && f.to === s.position)?.price ?? 0,
                "F",
              )}
            </Choice>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-sm font-bold text-muted-foreground">Places</span>
          <span className="text-xs text-muted-foreground">
            {seats ? `Siège(s) ${seats.join(", ")}` : "Pas assez de places"}{" "}
            <button
              type="button"
              onClick={() => setShowMap((v) => !v)}
              className="font-bold text-primary"
            >
              {showMap ? "Masquer le plan" : "Choisir"}
            </button>
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Une place de moins"
            onClick={() => setPassengers(count - 1)}
            className="size-11 rounded-xl bg-secondary text-xl font-bold"
          >
            −
          </button>
          <span className="w-8 text-center text-lg font-extrabold">{count}</span>
          <button
            type="button"
            aria-label="Une place de plus"
            onClick={() => setPassengers(count + 1)}
            className="size-11 rounded-xl bg-secondary text-xl font-bold"
          >
            +
          </button>
        </div>
      </div>

      {showMap && (
        <SeatPicker
          model={departure.model}
          free={free}
          chosen={seats ?? []}
          onToggle={toggleSeat}
        />
      )}

      <div className="flex flex-col gap-2">
        {names.map((n, i) => (
          <input
            key={i}
            aria-label={`Nom du voyageur ${i + 1}`}
            value={n}
            onChange={(e) => setNames((list) => list.map((x, k) => (k === i ? e.target.value : x)))}
            placeholder={
              count > 1
                ? `Nom du voyageur ${i + 1} (siège ${seats?.[i] ?? "?"})`
                : "Nom du voyageur"
            }
            maxLength={80}
            className={inputClass}
          />
        ))}
        <input
          aria-label="Téléphone du voyageur (facultatif)"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Téléphone (facultatif, pour le billet par SMS)"
          className={inputClass}
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-bold text-muted-foreground">Encaissement</span>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PAYMENTS.map((p) => (
            <Choice key={p.key} selected={payment === p.key} onClick={() => setPayment(p.key)}>
              {p.label}
            </Choice>
          ))}
        </div>
      </div>

      {error && <Notice>{error}</Notice>}
      <Button
        type="submit"
        disabled={busy || !seats}
        className="h-14 rounded-2xl text-base font-extrabold"
      >
        {busy
          ? "Enregistrement…"
          : `${payment === "especes" ? "Encaisser" : "Valider"} ${formatFcfa(total, "F")}`}
      </Button>
    </form>
  );
}

function ReceiptView({
  receipt,
  stationName,
  companyName,
  onDone,
}: {
  receipt: Receipt;
  stationName: string;
  companyName: string;
  onDone: () => void;
}) {
  const { departure, from, to } = receipt;
  const fromStop = departure.stops.find((s) => s.position === from);
  const toStop = departure.stops.find((s) => s.position === to);
  const at = addMinutes(departure.departure_time, fromStop?.minutes ?? 0);
  const [qrs, setQrs] = useState<Record<string, string>>({});
  const ids = receipt.tickets.flatMap((t) => (t.id ? [t.id] : []));
  const idsKey = ids.join(",");

  useEffect(() => {
    if (!idsKey) return;
    void signTickets({ data: { ticketIds: idsKey.split(",") } })
      .then((r) => setQrs(Object.fromEntries(r.tickets.map((t) => [t.id, t.qr]))))
      .catch(() => setQrs({}));
  }, [idsKey]);

  return (
    <div className="flex flex-col gap-4">
      {receipt.pending ? (
        <Notice>
          Pas de réseau : la vente est gardée sur ce téléphone et sera envoyée automatiquement. Les
          codes des billets arriveront à ce moment-là.
        </Notice>
      ) : (
        <Notice tone="success">Vente enregistrée. Remettez le billet au voyageur.</Notice>
      )}
      <div className="print-area flex flex-col gap-3">
        {receipt.tickets.map((t) => (
          <article
            key={t.seat}
            className="flex flex-col gap-1 rounded-2xl border-2 border-dashed border-input bg-card p-4 text-sm"
          >
            <div className="flex justify-between font-extrabold">
              <span>{companyName}</span>
              <span>{formatFcfa(t.price, "F")}</span>
            </div>
            <span className="text-lg font-extrabold">
              {fromStop?.city} {at} → {toStop?.city}
            </span>
            <span>
              {dayLabel(departure.departure_date)} · Siège {t.seat} · {t.name}
            </span>
            <span className="text-muted-foreground">
              Gare : {stationName} · présentez-vous 30 min avant le départ
            </span>
            <span className="text-base font-extrabold tracking-widest">
              {t.code ?? "Code en attente de réseau"}
            </span>
            {t.id && qrs[t.id] && (
              <TicketQr value={qrs[t.id] ?? ""} label={`QR code du billet ${t.code ?? ""}`} />
            )}
          </article>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => window.print()}
          className="h-12 rounded-xl px-5 font-bold"
        >
          Imprimer
        </Button>
        <Button type="button" onClick={onDone} className="h-12 rounded-xl px-6 font-extrabold">
          Nouvelle vente
        </Button>
      </div>
    </div>
  );
}

function Manifest({
  departure,
  stationId,
  companyName,
}: {
  departure: GuichetDeparture;
  stationId: string;
  companyName: string;
}) {
  const city = (p: number) => departure.stops.find((s) => s.position === p)?.city ?? "?";
  const here = departure.stops.find((s) => s.stationId === stationId)?.position;
  const list = departure.tickets
    .filter((t) => t.status !== "annule" && t.status !== "reserve")
    .sort((a, b) => a.seat - b.seat);
  const boarding = list.filter((t) => t.from === here).length;
  const leaving = list.filter((t) => t.to === here).length;
  return (
    <div className="flex flex-col gap-3">
      <div className="print-area flex flex-col gap-2 rounded-2xl bg-card p-4">
        <span className="font-extrabold">
          {companyName} · {departure.route.name} · {dayLabel(departure.departure_date)}{" "}
          {departure.departure_time}
        </span>
        <span className="text-sm text-muted-foreground">
          {list.length} passager(s) sur {departure.model.capacity} places · montent ici : {boarding}
          {leaving > 0 ? ` · descendent ici : ${leaving}` : ""}
        </span>
        {list.length === 0 && <p className="text-sm text-muted-foreground">Aucun billet vendu.</p>}
        {list.length > 0 && (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1 pr-2">Siège</th>
                <th className="py-1 pr-2">Voyageur</th>
                <th className="py-1 pr-2">Trajet</th>
                <th className="py-1">Code</th>
              </tr>
            </thead>
            <tbody>
              {list.map((t) => (
                <tr key={`${t.seat}-${t.from}`} className="border-t">
                  <td className="py-1.5 pr-2 font-extrabold">{t.seat}</td>
                  <td className="py-1.5 pr-2">{t.name}</td>
                  <td className="py-1.5 pr-2">
                    {city(t.from)} → {city(t.to)}
                  </td>
                  <td className="py-1.5 font-mono text-xs">{t.code}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={() => window.print()}
        className="h-12 w-fit rounded-xl px-5 font-bold"
      >
        Imprimer la liste
      </Button>
    </div>
  );
}

function Shell({ header, children }: { header?: ReactNode; children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col bg-background">
      <header className="bg-sidebar px-4 py-4 text-sidebar-foreground sm:px-6">
        {header ?? (
          <Link
            to="/pro"
            className="flex items-center gap-2 font-extrabold text-sidebar-foreground no-underline"
          >
            Tufani Pro
          </Link>
        )}
      </header>
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-5 sm:px-6">
        {children}
      </section>
      <footer className="mx-auto w-full max-w-3xl px-4 pb-8 text-sm sm:px-6">
        <Link to="/pro" className="font-bold text-primary">
          Espace compagnie
        </Link>
      </footer>
    </main>
  );
}
