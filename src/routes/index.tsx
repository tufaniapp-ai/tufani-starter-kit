import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Tufani" },
      { name: "description", content: "Tufani — nouveau projet." },
      { property: "og:title", content: "Tufani" },
      { property: "og:description", content: "Tufani — nouveau projet." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background">
      <h1 className="text-5xl font-semibold tracking-tight text-foreground">Tufani</h1>
    </main>
  );
}
