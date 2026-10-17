import { seatMap, type BusModel } from "@/domain/seats";
import { cn } from "@/lib/utils";

/** Plan du bus : sièges libres cliquables, sièges pris barrés. Sert au guichet et au site. */
export function SeatPicker({
  model,
  free,
  chosen,
  onToggle,
}: {
  model: Pick<BusModel, "rows" | "pattern">;
  free: Set<number>;
  chosen: number[];
  onToggle: (n: number) => void;
}) {
  return (
    <div
      className="mx-auto grid w-fit gap-1.5 rounded-2xl bg-secondary p-3"
      style={{ gridTemplateColumns: `repeat(${model.pattern.length}, 2.5rem)` }}
    >
      {seatMap({ id: "", name: "", ...model })
        .flat()
        .map((c, i) =>
          c.kind === "aisle" ? (
            <span key={i} />
          ) : (
            <button
              key={i}
              type="button"
              disabled={!free.has(c.number) && !chosen.includes(c.number)}
              onClick={() => onToggle(c.number)}
              aria-label={`Siège ${c.number}${c.window ? ", fenêtre" : ""}${free.has(c.number) ? "" : ", occupé"}`}
              aria-pressed={chosen.includes(c.number)}
              className={cn(
                "h-9 rounded-md text-xs font-bold",
                chosen.includes(c.number)
                  ? "bg-primary text-primary-foreground"
                  : free.has(c.number)
                    ? "border-2 border-input bg-card"
                    : "bg-muted-foreground/25 text-muted-foreground line-through",
              )}
            >
              {c.number}
            </button>
          ),
        )}
    </div>
  );
}
