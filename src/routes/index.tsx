import { createFileRoute } from "@tanstack/react-router";

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
  return (
    <main className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center gap-3 px-5 py-5 sm:px-10">
        <span
          aria-hidden="true"
          className="flex size-10 items-center justify-center rounded-xl bg-primary text-xl font-extrabold text-highlight"
        >
          T
        </span>
        <span className="text-xl font-extrabold tracking-tight text-foreground">Tufani</span>
      </header>

      <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 px-5 pb-16 sm:px-10">
        <p className="text-sm font-bold text-primary">Billets de bus au Mali</p>
        <h1 className="text-4xl leading-tight font-extrabold tracking-tight text-foreground sm:text-6xl">
          Votre billet de bus en une minute, sans faire la queue.
        </h1>
        <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">
          Toutes les compagnies au même endroit, paiement par Orange Money, Wave ou Moov Money, et
          billet par SMS valable sans connexion.
        </p>
        <p className="w-fit rounded-full bg-accent px-4 py-2 text-sm font-bold text-accent-foreground">
          Lancement prochainement
        </p>
      </section>
    </main>
  );
}
