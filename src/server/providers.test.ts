import { describe, expect, it } from "vitest";

import { SimulatedPaymentProvider } from "./payments.server";
import { SimulatedSmsProvider } from "./sms.server";

describe("simulateur de paiement", () => {
  it("paie, échoue ou attend selon le montant", async () => {
    const p = new SimulatedPaymentProvider();
    const ok = await p.initiate({
      orderRef: "A1",
      amount: 6000,
      method: "orange_money",
      payerPhone: "+22376123421",
    });
    const ko = await p.initiate({ orderRef: "A2", amount: 6001, method: "orange_money" });
    const wait = await p.initiate({ orderRef: "A3", amount: 6002, method: "wave" });
    expect((await p.verify(ok.providerRef)).status).toBe("payee");
    expect(await p.verify(ko.providerRef)).toMatchObject({
      status: "echouee",
      failureReason: "solde_insuffisant",
    });
    expect((await p.verify(wait.providerRef)).status).toBe("en_attente");
    expect(wait.redirectUrl).toBeDefined();
  });

  it("ne crée pas deux paiements pour la même commande", async () => {
    const p = new SimulatedPaymentProvider();
    const a = await p.initiate({ orderRef: "B1", amount: 6000, method: "orange_money" });
    const b = await p.initiate({ orderRef: "B1", amount: 6000, method: "orange_money" });
    expect(b.providerRef).toBe(a.providerRef);
  });

  it("rembourse une seule fois, jamais plus que payé", async () => {
    const p = new SimulatedPaymentProvider();
    const { providerRef } = await p.initiate({
      orderRef: "C1",
      amount: 6000,
      method: "orange_money",
    });
    expect((await p.refund(providerRef, 7000)).status).toBe("echouee");
    expect((await p.refund(providerRef, 6000)).status).toBe("remboursee");
    expect((await p.refund(providerRef, 6000)).status).toBe("echouee");
  });
});

describe("simulateur de SMS", () => {
  it("garde les messages et refuse ceux de plus de 160 caractères", async () => {
    const sms = new SimulatedSmsProvider();
    await sms.send({
      to: "+22376123421",
      body: "Tufani : billet TFN-7K4P, Bamako 07:30 > Segou, siege 14.",
    });
    expect(sms.outbox).toHaveLength(1);
    await expect(sms.send({ to: "+22376123421", body: "x".repeat(161) })).rejects.toThrow();
  });
});
