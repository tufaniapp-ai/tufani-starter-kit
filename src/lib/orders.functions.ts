import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { MAX_ONLINE_PASSENGERS } from "@/domain/booking";

/** Tient les sièges 10 minutes et envoie la demande de paiement au téléphone du voyageur. */
export const startOrder = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        departureId: z.string().uuid(),
        from: z.number().int().min(0).max(30),
        to: z.number().int().min(1).max(30),
        buyerPhone: z.string().trim().min(8).max(20),
        method: z.enum(["orange_money", "wave", "moov_money"]),
        passengers: z
          .array(
            z.object({
              name: z.string().trim().min(2).max(80),
              phone: z.string().trim().max(20),
              seat: z.number().int().min(1).max(200),
            }),
          )
          .min(1)
          .max(MAX_ONLINE_PASSENGERS),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { startOrder: start } = await import("@/server/orders.server");
    return start(data);
  });

/** État de la commande ; émet les billets dès que le paiement est confirmé. */
export const refreshOrder = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ orderId: z.string().uuid(), key: z.string().regex(/^[0-9a-f]{64}$/) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { refreshOrder: refresh } = await import("@/server/orders.server");
    return refresh(data.orderId, data.key);
  });
