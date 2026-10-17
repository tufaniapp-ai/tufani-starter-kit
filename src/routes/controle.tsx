import { Link, createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { Choice, Notice, inputClass } from "@/components/pro/ui";
import { Button } from "@/components/ui/button";
import {
  decideScan,
  normalizeCode,
  type ManifestTicket,
  type ScanDecision,
} from "@/domain/controle";
import { addMinutes, isoDay } from "@/domain/guichet";
import { verifyTicketQr } from "@/domain/ticket-qr";
import { db } from "@/lib/db";
import {
  SCANNER_ROLES,
  loadDepartures,
  loadStaff,
  loadStations,
  type GuichetDeparture,
  type StaffMembership,
  type Station,
} from "@/lib/guichet-data";
import { isNetworkError } from "@/lib/offline-queue";
import {
  enqueueScan,
  markBoardedLocally,
  readManifest,
  readPublicKey,
  readScanQueue,
  removeScan,
  saveManifest,
  savePublicKey,
  type PendingScan,
} from "@/lib/scan-store";
import { getTicketPublicKey } from "@/lib/tickets.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/controle")({
  head: () => ({
    meta: [{ title: "Embarquement — Tufani Pro" }, { name: "robots", content: "noindex" }],
  }),
  component: Controle,
});

const STATION_KEY = "tufani.controle.gare";

type Shown = { decision: ScanDecision; at: string; offline: boolean };

function toManifest(d: GuichetDeparture): ManifestTicket[] {
  return d.tickets.map((t) => ({
    id: t.id,
    code: t.code,
    seat: t.seat,
    name: t.name,
    from: t.from,
    to: t.to,
    status: t.status === "annule" ? "annule" : t.boardedAt ? "embarque" : "valide",
    boardedAt: t.boardedAt,
  }));
}

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

function Controle() {
  const [state, setState] = useState<"loading" | "anonymous" | "forbidden" | "error" | "ready">(
    "loading",
  );
  const [memberships, setMemberships] = useState<StaffMembership[]>([]);
  const [membership, setMembership] = useState<StaffMembership | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [stationId, setStationId] = useState("");
  const [departures, setDepartures] = useState<GuichetDeparture[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [manifest, setManifest] = useState<ManifestTicket[]>([]);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [queue, setQueue] = useState<PendingScan[]>([]);
  const [online, setOnline] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setPublicKey(readPublicKey());
    void getTicketPublicKey()
      .then((r) => {
        savePublicKey(r.publicKey);
        setPublicKey(r.publicKey);
      })
      .catch(() => {
        /* hors ligne : on garde la clé déjà téléchargée */
      });
    void (async () => {
      try {
        const staff = await loadStaff(SCANNER_ROLES);
        if (!staff) return setState("anonymous");
        if (staff.memberships.length === 0) return setState("forbidden");
        setMemberships(staff.memberships);
        setMembership(staff.memberships[0] ?? null);
        setState("ready");
      } catch {
        setState("error");
      }
    })();
  }, []);

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
      const deps = await loadDepartures(membership.company_id, isoDay(0), stationId);
      // La liste du téléphone garde les montées pas encore envoyées.
      const pending = new Set(readScanQueue().map((s) => s.ticketId ?? s.code));
      for (const d of deps) {
        const local = readManifest(d.id)?.tickets ?? [];
        const fresh = toManifest(d).map((t) => {
          const mine = local.find((l) => l.id === t.id);
          return !t.boardedAt && mine?.boardedAt && (pending.has(t.id) || pending.has(t.code))
            ? mine
            : t;
        });
        saveManifest(d.id, fresh);
      }
      setDepartures(deps);
      setLoadError(null);
    } catch (e) {
      setLoadError(
        isNetworkError(e)
          ? "Pas de réseau : vous pouvez scanner avec la liste déjà téléchargée."
          : "Impossible de charger les départs.",
      );
    }
  }, [membership, stationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selected) return;
    const saved = readManifest(selected);
    setManifest(saved?.tickets ?? []);
    setSavedAt(saved?.savedAt ?? null);
  }, [selected, departures]);

  const flush = useCallback(async () => {
    for (const s of readScanQueue()) {
      const { error } = await db.rpc("board_ticket", {
        p_departure: s.departureId,
        p_station: s.stationId,
        p_ticket: s.ticketId,
        p_code: s.code,
        p_scanned_at: s.scannedAt,
        p_scan_ref: s.scanRef,
        p_offline: true,
      });
      if (error && isNetworkError(error)) break;
      // Refus de la base (droits, départ supprimé) : le scan reste au journal du téléphone seulement.
      removeScan(s.scanRef);
    }
    setQueue(readScanQueue());
  }, []);

  useEffect(() => {
    setQueue(readScanQueue());
    setOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    const up = () => {
      setOnline(true);
      void flush().then(refresh);
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    const timer = setInterval(() => {
      if (navigator.onLine && readScanQueue().length > 0) void flush();
    }, 30000);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      clearInterval(timer);
    };
  }, [flush, refresh]);

  function chooseStation(id: string) {
    setStationId(id);
    setSelected(null);
    try {
      localStorage.setItem(STATION_KEY, id);
    } catch {
      /* choix valable pour cette visite */
    }
  }

  async function handleScan(raw: string) {
    if (!selected) return;
    const departureId = selected;
    const text = raw.trim();
    let decision: ScanDecision;
    if (text.startsWith("TFN1|")) {
      if (!publicKey) {
        setShown({ decision: { kind: "faux" }, at: new Date().toISOString(), offline: false });
        setLoadError("Clé de vérification absente : connectez-vous une fois au réseau.");
        return;
      }
      const v = await verifyTicketQr(text, publicKey);
      decision = v.ok ? decideScan({ claims: v.claims }, departureId, manifest) : { kind: "faux" };
    } else {
      const code = normalizeCode(text);
      decision = code ? decideScan({ code }, departureId, manifest) : { kind: "faux" };
    }

    const at = new Date().toISOString();
    if (decision.kind !== "ok") {
      setShown({ decision, at, offline: false });
      return;
    }

    const ticket: ManifestTicket = { ...decision.ticket, status: "valide", boardedAt: null };
    markBoardedLocally(departureId, ticket, at);
    setManifest(readManifest(departureId)?.tickets ?? []);
    const scan: PendingScan = {
      scanRef: crypto.randomUUID(),
      departureId,
      stationId,
      ticketId: decision.ticket.id,
      code: decision.ticket.code,
      scannedAt: at,
    };

    const { data, error } = await db.rpc("board_ticket", {
      p_departure: scan.departureId,
      p_station: scan.stationId,
      p_ticket: scan.ticketId,
      p_code: scan.code,
      p_scanned_at: at,
      p_scan_ref: scan.scanRef,
      p_offline: false,
    });
    if (error) {
      if (isNetworkError(error)) {
        enqueueScan(scan);
        setQueue(readScanQueue());
        setShown({ decision, at, offline: true });
      } else {
        setShown({ decision: { kind: "faux" }, at, offline: false });
        setLoadError(error.message);
      }
      return;
    }
    // La base a le dernier mot : un autre téléphone a pu faire monter ce billet avant.
    const r = data as {
      result: string;
      seat: number;
      name: string;
      code: string;
      boarded_at: string | null;
    };
    const known: ManifestTicket = {
      ...ticket,
      seat: r.seat,
      name: r.name || ticket.name,
      code: r.code,
    };
    if (r.result === "embarque") {
      setShown({
        decision: { kind: "ok", sinceDownload: decision.sinceDownload, ticket: known },
        at,
        offline: false,
      });
    } else if (r.result === "deja_embarque") {
      const boardedAt = r.boarded_at ?? at;
      markBoardedLocally(departureId, known, boardedAt);
      setManifest(readManifest(departureId)?.tickets ?? []);
      setShown({ decision: { kind: "deja", ticket: known, boardedAt }, at, offline: false });
    } else if (r.result === "annule") {
      setShown({ decision: { kind: "annule", ticket: known }, at, offline: false });
    } else {
      setShown({
        decision: { kind: r.result === "autre_depart" ? "autre_depart" : "faux" },
        at,
        offline: false,
      });
    }
  }

  const station = stations.find((s) => s.id === stationId);
  const departure = departures?.find((d) => d.id === selected) ?? null;
  const valid = manifest.filter((t) => t.status !== "annule");
  const boarded = valid.filter((t) => t.boardedAt).length;

  if (state !== "ready") {
    return (
      <Shell>
        {state === "loading" && <p className="text-muted-foreground">Chargement…</p>}
        {state === "anonymous" && (
          <div className="flex flex-col gap-4">
            <h1 className="text-2xl font-extrabold">Embarquement</h1>
            <p className="text-muted-foreground">Connectez-vous avec votre numéro pour scanner.</p>
            <Button asChild className="h-12 w-fit rounded-xl px-6 font-extrabold">
              <Link to="/connexion" search={{ suite: "/controle" }}>
                Se connecter
              </Link>
            </Button>
          </div>
        )}
        {state === "forbidden" && (
          <Notice>Votre compte n'a pas accès à l'embarquement. Demandez à votre gérant.</Notice>
        )}
        {state === "error" && (
          <Notice>
            Impossible de charger l'embarquement. Vérifiez votre connexion internet, puis rechargez
            la page.
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
                Embarquement {station ? `· ${station.name}` : ""}
              </span>
              <span className="text-xs text-white/70">{membership?.company.name}</span>
            </div>
            {departure && (
              <span className="rounded-full bg-highlight px-3 py-1 text-xs font-extrabold text-highlight-foreground">
                {boarded} / {valid.length} à bord
              </span>
            )}
          </div>
          {(!online || queue.length > 0) && (
            <p className="rounded-lg bg-warning px-3 py-2 text-xs font-bold text-warning-foreground">
              {online ? "" : "Hors ligne · "}
              {queue.length > 0
                ? `${queue.length} scan(s) en attente d'envoi`
                : "les scans seront envoyés au retour du réseau"}
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
      {stations.length > 1 && !departure && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Gare">
          {stations.map((s) => (
            <Choice key={s.id} selected={s.id === stationId} onClick={() => chooseStation(s.id)}>
              {s.name} · {s.city}
            </Choice>
          ))}
        </div>
      )}
      {loadError && <Notice>{loadError}</Notice>}
      {!publicKey && (
        <Notice>
          La clé de vérification des billets n'est pas encore sur ce téléphone. Ouvrez cette page
          une fois avec du réseau.
        </Notice>
      )}

      {!departure ? (
        <DepartureList departures={departures} stationId={stationId} onPick={setSelected} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-col">
              <span className="text-xl font-extrabold">
                {addMinutes(
                  departure.departure_time,
                  departure.stops.find((s) => s.stationId === stationId)?.minutes ?? 0,
                )}{" "}
                · {departure.route.name}
              </span>
              <span className="text-xs text-muted-foreground">
                {savedAt
                  ? `Liste téléchargée à ${hhmm(savedAt)} · vérification sans réseau possible`
                  : "Liste non téléchargée"}
              </span>
            </div>
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => {
                setSelected(null);
                setShown(null);
              }}
            >
              Changer de départ
            </Button>
          </div>

          {shown && (
            <ResultCard shown={shown} departure={departure} onClose={() => setShown(null)} />
          )}

          <Scanner onScan={(v) => void handleScan(v)} paused={shown !== null} />
          <ManualEntry onSubmit={(v) => void handleScan(v)} />
          <PassengerList tickets={manifest} departure={departure} />
        </>
      )}
    </Shell>
  );
}

function DepartureList({
  departures,
  stationId,
  onPick,
}: {
  departures: GuichetDeparture[] | null;
  stationId: string;
  onPick: (id: string) => void;
}) {
  if (departures === null)
    return <p className="text-sm text-muted-foreground">Chargement des départs…</p>;
  if (departures.length === 0)
    return <Notice tone="info">Aucun départ de cette gare aujourd'hui.</Notice>;
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-lg font-extrabold">Départs d'aujourd'hui</h2>
      {departures.map((d) => {
        const stop = d.stops.find((s) => s.stationId === stationId);
        const valid = d.tickets.filter((t) => t.status !== "annule");
        return (
          <button
            key={d.id}
            type="button"
            onClick={() => onPick(d.id)}
            className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-left hover:border-primary"
          >
            <span className="flex flex-col">
              <span className="text-lg font-extrabold">
                {addMinutes(d.departure_time, stop?.minutes ?? 0)}
              </span>
              <span className="text-sm text-muted-foreground">{d.route.name}</span>
            </span>
            <span className="text-sm font-bold">
              {valid.filter((t) => t.boardedAt).length} / {valid.length} à bord
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ResultCard({
  shown,
  departure,
  onClose,
}: {
  shown: Shown;
  departure: GuichetDeparture;
  onClose: () => void;
}) {
  const d = shown.decision;
  const city = (pos: number) => departure.stops.find((s) => s.position === pos)?.city ?? "";
  let tone: "ok" | "warn" | "ko";
  let title: string;
  let detail: ReactNode = null;
  switch (d.kind) {
    case "ok":
      tone = "ok";
      title = `Valide · siège ${d.ticket.seat}`;
      detail = (
        <>
          {d.ticket.name && <strong>{d.ticket.name}</strong>} {city(d.ticket.from)} →{" "}
          {city(d.ticket.to)} · {d.ticket.code}
          {shown.offline && (
            <span className="block">Enregistré sur le téléphone, envoyé au retour du réseau.</span>
          )}
        </>
      );
      break;
    case "deja":
      tone = "warn";
      title = `Déjà embarqué à ${hhmm(d.boardedAt)}`;
      detail = (
        <>
          Siège {d.ticket.seat} · {d.ticket.code}. Ce billet a déjà fait monter quelqu'un : ne
          laissez pas monter.
        </>
      );
      break;
    case "annule":
      tone = "ko";
      title = "Billet annulé";
      detail = (
        <>
          Siège {d.ticket.seat} · {d.ticket.code}. Envoyez le voyageur au guichet.
        </>
      );
      break;
    case "autre_depart":
      tone = "ko";
      title = "Billet d'un autre départ";
      detail = <>Vérifiez l'heure et la ligne avec le voyageur, ou envoyez-le au guichet.</>;
      break;
    case "inconnu":
      tone = "ko";
      title = "Code inconnu";
      detail = <>Aucun billet {d.code} sur ce départ. Faites vérifier au guichet.</>;
      break;
    default:
      tone = "ko";
      title = "Billet non valide";
      detail = <>Ce QR n'est pas un billet Tufani authentique, ou il a été modifié.</>;
  }
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col gap-2 rounded-2xl px-5 py-5",
        tone === "ok" && "bg-primary text-primary-foreground",
        tone === "warn" && "bg-warning text-warning-foreground",
        tone === "ko" && "bg-destructive text-white",
      )}
    >
      <span className="text-2xl font-extrabold">{title}</span>
      <span className="text-sm">{detail}</span>
      <Button
        variant="secondary"
        className="mt-2 h-12 w-full rounded-xl font-extrabold"
        onClick={onClose}
        autoFocus
      >
        Scanner le suivant
      </Button>
    </div>
  );
}

type Detector = { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> };

function Scanner({ onScan, paused }: { onScan: (value: string) => void; paused: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"off" | "on" | "unsupported" | "denied">("off");
  const pausedRef = useRef(paused);
  const onScanRef = useRef(onScan);
  pausedRef.current = paused;
  onScanRef.current = onScan;

  useEffect(() => {
    if (status !== "on") return;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let stopped = false;
    const Ctor = (
      window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }
    ).BarcodeDetector;
    if (!Ctor) {
      setStatus("unsupported");
      return;
    }
    const detector = new Ctor({ formats: ["qr_code"] });
    void navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then(async (s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (!video.current) return;
        video.current.srcObject = s;
        await video.current.play();
        let busy = false;
        timer = setInterval(() => {
          if (busy || pausedRef.current || !video.current) return;
          busy = true;
          void detector
            .detect(video.current)
            .then((codes) => {
              const value = codes[0]?.rawValue;
              if (value) onScanRef.current(value);
            })
            .catch(() => undefined)
            .finally(() => {
              busy = false;
            });
        }, 300);
      })
      .catch(() => setStatus("denied"));
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [status]);

  if (status === "off")
    return (
      <Button className="h-14 rounded-2xl text-lg font-extrabold" onClick={() => setStatus("on")}>
        Ouvrir la caméra
      </Button>
    );
  if (status === "unsupported")
    return (
      <Notice tone="info">
        Ce téléphone ne lit pas les QR depuis le navigateur. Saisissez le code du billet ci-dessous.
      </Notice>
    );
  if (status === "denied")
    return (
      <Notice>
        Caméra refusée. Autorisez la caméra pour ce site dans le navigateur, ou saisissez le code.
      </Notice>
    );
  return (
    <div className="flex flex-col gap-2">
      <video
        ref={video}
        muted
        playsInline
        className={cn(
          "aspect-square w-full rounded-2xl bg-black object-cover",
          paused && "opacity-40",
        )}
      />
      <Button variant="outline" className="rounded-xl" onClick={() => setStatus("off")}>
        Fermer la caméra
      </Button>
    </div>
  );
}

function ManualEntry({ onSubmit }: { onSubmit: (value: string) => void }) {
  const [value, setValue] = useState("");
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    onSubmit(value);
    setValue("");
  }
  return (
    <form onSubmit={submit} className="flex gap-2">
      <label className="sr-only" htmlFor="code-billet">
        Code du billet
      </label>
      <input
        id="code-billet"
        className={cn(inputClass, "uppercase")}
        placeholder="Code du billet (TFN-…)"
        autoComplete="off"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button type="submit" className="h-12 rounded-xl px-5 font-extrabold">
        Vérifier
      </Button>
    </form>
  );
}

function PassengerList({
  tickets,
  departure,
}: {
  tickets: ManifestTicket[];
  departure: GuichetDeparture;
}) {
  const [filter, setFilter] = useState<"attendus" | "tous">("attendus");
  const city = (pos: number) => departure.stops.find((s) => s.position === pos)?.city ?? "";
  const list = tickets
    .filter((t) => t.status !== "annule")
    .filter((t) => filter === "tous" || !t.boardedAt)
    .sort((a, b) => a.seat - b.seat);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-extrabold">Passagers</h2>
        <div className="flex gap-2">
          <Choice selected={filter === "attendus"} onClick={() => setFilter("attendus")}>
            Pas encore montés
          </Choice>
          <Choice selected={filter === "tous"} onClick={() => setFilter("tous")}>
            Tous
          </Choice>
        </div>
      </div>
      {list.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {filter === "attendus" ? "Tout le monde est à bord." : "Aucun billet vendu."}
        </p>
      )}
      <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
        {list.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
            <span className="w-10 font-extrabold">{t.seat}</span>
            <span className="flex-1">
              {t.name || "—"}
              <span className="block text-xs text-muted-foreground">
                {city(t.from)} → {city(t.to)} · {t.code}
              </span>
            </span>
            <span
              className={cn(
                "text-xs font-bold",
                t.boardedAt ? "text-primary" : "text-muted-foreground",
              )}
            >
              {t.boardedAt ? `à bord ${hhmm(t.boardedAt)}` : "attendu"}
            </span>
          </li>
        ))}
      </ul>
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
