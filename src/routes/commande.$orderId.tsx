import { Link, createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

import { Notice } from "@/components/pro/ui";
import { PublicShell } from "@/components/PublicShell";
import { TicketQr } from "@/components/TicketQr";
import { Button } from "@/components/ui/button";
import { maliDay, maliTime, type OrderView } from "@/domain/booking";
import { dayLabel } from "@/domain/guichet";
import { formatFcfa } from "@/domain/money";
import { formatLocalPhone } from "@/domain/phone";
import { refreshOrder } from "@/lib/orders.functions";

export const Route = createFileRoute("/commande/$orderId")({
  validateSearch: (s: Record<string, unknown>): { k: string } => ({
    k: typeof s["k"] === "string" ? s["k"] : "",
  }),
  head: () => ({
    meta: [{ title: "Mon billet — Tufani" }, { name: "robots", content: "noindex" }],
  }),
  component: Commande,
});

const METHOD_LABELS = { orange_money: "Orange Money", wave: "Wave", moov_money: "Moov Money" };

function Commande() {
  const { orderId } = Route.useParams();
  const { k } = Route.useSearch();
  const [order, setOrder] = useState<OrderView | null | undefined>(undefined);
  const [offline, setOffline] = useState(false);
  const polls = useRef(0);

  const check = useCallback(async () => {
    try {
      const o = await refreshOrder({ data: { orderId, key: k } });
      setOrder(o);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, [orderId, k]);

  useEffect(() => {
    void check();
  }, [check]);

  // En attente du paiement : on revérifie toutes les 4 secondes pendant 12 minutes.
  useEffect(() => {
    if (order?.status !== "en_attente") return;
    const timer = setInterval(() => {
      polls.current += 1;
      if (polls.current > 180) return clearInterval(timer);
      void check();
    }, 4000);
    return () => clearInterval(timer);
  }, [order?.status, check]);

  if (order === undefined) {
    return (
      <PublicShell>
        <p className="text-muted-foreground">
          {offline ? "Pas de réseau. Réessayez dans un instant." : "Chargement de votre commande…"}
        </p>
      </PublicShell>
    );
  }
  if (order === null) {
    return (
      <PublicShell>
        <Notice>Commande introuvable. Vérifiez le lien reçu par SMS.</Notice>
      </PublicShell>
    );
  }

  const trip = (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-bold text-primary">{order.company}</span>
      <h1 className="text-2xl font-extrabold">
        {order.from_city} → {order.to_city}
      </h1>
      <p className="text-sm text-muted-foreground">
        {dayLabel(maliDay(order.leaves_at))} · départ {maliTime(order.leaves_at)} de{" "}
        {order.from_station}
      </p>
    </div>
  );

  if (order.status === "en_attente") {
    return (
      <PublicShell>
        {trip}
        <div className="flex flex-col gap-3 rounded-2xl bg-highlight p-5 text-highlight-foreground">
          <span className="text-xl font-extrabold">
            Validez le paiement de {formatFcfa(order.amount, "F")}
          </span>
          <p className="text-sm font-semibold">
            Une demande {METHOD_LABELS[order.method]} est envoyée au{" "}
            {formatLocalPhone(order.buyer_phone)}. Confirmez-la avec votre code secret. Cette page
            se met à jour toute seule.
          </p>
          <p className="text-xs">
            Sièges {order.tickets.map((t) => t.seat).join(", ")} gardés jusqu'à{" "}
            {maliTime(order.hold_until)}.
          </p>
        </div>
        <Button variant="outline" className="h-12 rounded-xl" onClick={() => void check()}>
          J'ai validé, vérifier maintenant
        </Button>
        {offline && <Notice>Pas de réseau : la vérification reprendra toute seule.</Notice>}
      </PublicShell>
    );
  }

  if (order.status === "payee") {
    return (
      <PublicShell>
        {trip}
        <Notice tone="success">
          Paiement reçu. Billet{order.tickets.length > 1 ? "s" : ""} envoyé
          {order.tickets.length > 1 ? "s" : ""} par SMS. Présentez le QR ou le code au contrôleur,
          même sans connexion.
        </Notice>
        <ul className="flex flex-col gap-4">
          {order.tickets.map((t) => (
            <li
              key={t.id ?? t.seat}
              className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-primary bg-card p-5 text-center"
            >
              <span className="text-sm text-muted-foreground">{t.name}</span>
              <span className="text-3xl font-extrabold">Siège {t.seat}</span>
              {t.id && order.qrs[t.id] && (
                <TicketQr
                  value={order.qrs[t.id] ?? ""}
                  size={220}
                  label={`QR du billet ${t.code ?? ""}`}
                />
              )}
              <span className="font-mono text-xl font-extrabold tracking-wider">{t.code}</span>
              <span className="text-xs text-muted-foreground">
                Présentez-vous 30 minutes avant le départ.
              </span>
            </li>
          ))}
        </ul>
        <p className="text-center text-xs text-muted-foreground">
          Gardez cette page : elle reste dans « Mes billets » sur ce téléphone.
        </p>
      </PublicShell>
    );
  }

  return (
    <PublicShell>
      {trip}
      {order.status === "a_rembourser" || order.status === "remboursee" ? (
        <Notice>
          Votre paiement est arrivé après la fin de la réservation et les sièges ont été repris.
          {order.status === "remboursee"
            ? " Vous avez été remboursé."
            : ` Vous serez remboursé de ${formatFcfa(order.amount, "F")} sur votre compte ${METHOD_LABELS[order.method]}.`}
        </Notice>
      ) : (
        <Notice>
          {order.status === "echouee"
            ? "Le paiement n'a pas abouti (solde insuffisant ou demande refusée). Aucun argent n'a été pris."
            : "Le délai de paiement est dépassé : les sièges ont été remis en vente."}
        </Notice>
      )}
      <Link
        to="/"
        className="w-fit rounded-xl bg-primary px-5 py-3 font-extrabold text-primary-foreground no-underline"
      >
        Refaire une recherche
      </Link>
    </PublicShell>
  );
}
