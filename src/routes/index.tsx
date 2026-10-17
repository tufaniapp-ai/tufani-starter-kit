import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { PublicShell } from "@/components/PublicShell";
import { SearchForm } from "@/components/SearchForm";
import { maliTime } from "@/domain/booking";
import { dayLabel } from "@/domain/guichet";
import { readMyOrders, type SavedOrder } from "@/lib/my-orders";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Tufani — Billets de bus au Mali" },
      {
        name: "description",
        content:
          "Comparez les départs de toutes les compagnies, choisissez votre siège et payez par Orange Money, Wave ou Moov Money. Billet par SMS.",
      },
      { property: "og:title", content: "Tufani — Billets de bus au Mali" },
      {
        property: "og:description",
        content: "Toutes les compagnies, paiement mobile, billet par SMS valable sans connexion.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const [mine, setMine] = useState<SavedOrder[]>([]);
  useEffect(() => {
    setMine(readMyOrders().filter((o) => Date.parse(o.leavesAt) > Date.now() - 6 * 3600000));
  }, []);

  return (
    <PublicShell>
      <div className="flex flex-col gap-3 pt-4">
        <p className="text-sm font-bold text-primary">Billets de bus au Mali</p>
        <h1 className="text-3xl leading-tight font-extrabold tracking-tight text-foreground sm:text-5xl">
          Votre billet de bus en une minute, sans faire la queue.
        </h1>
        <p className="text-base leading-relaxed text-muted-foreground sm:text-lg">
          Choisissez votre siège, payez par Orange Money, Wave ou Moov Money, et recevez votre
          billet par SMS.
        </p>
      </div>

      <SearchForm />

      {mine.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-extrabold">Mes billets</h2>
          {mine.map((o) => (
            <Link
              key={o.id}
              to="/commande/$orderId"
              params={{ orderId: o.id }}
              search={{ k: o.key }}
              className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3 no-underline hover:border-primary"
            >
              <span className="font-bold text-foreground">{o.label}</span>
              <span className="text-sm text-muted-foreground">
                {dayLabel(o.leavesAt.slice(0, 10))} · {maliTime(o.leavesAt)}
              </span>
            </Link>
          ))}
        </div>
      )}

      <ul className="grid gap-3 text-sm sm:grid-cols-3">
        <li className="rounded-xl bg-secondary px-4 py-3">
          <strong className="block text-foreground">Toutes les compagnies</strong>
          <span className="text-muted-foreground">
            Heures, prix et places restantes côte à côte.
          </span>
        </li>
        <li className="rounded-xl bg-secondary px-4 py-3">
          <strong className="block text-foreground">Votre siège à vous</strong>
          <span className="text-muted-foreground">
            Choisi sur le plan du bus, garanti à l'embarquement.
          </span>
        </li>
        <li className="rounded-xl bg-secondary px-4 py-3">
          <strong className="block text-foreground">Billet sans connexion</strong>
          <span className="text-muted-foreground">
            Le code du SMS suffit pour monter dans le bus.
          </span>
        </li>
      </ul>
    </PublicShell>
  );
}
