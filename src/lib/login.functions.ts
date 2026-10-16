import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const requestLoginCode = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ phone: z.string().trim().min(8).max(20) }).parse(d))
  .handler(async ({ data }) => {
    const { sendLoginCode } = await import("@/server/login.server");
    return sendLoginCode(data.phone);
  });

export const verifyLoginCode = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        phone: z.string().trim().min(8).max(20),
        code: z
          .string()
          .trim()
          .regex(/^\d{6}$/),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { checkLoginCode } = await import("@/server/login.server");
    return checkLoginCode(data.phone, data.code);
  });
