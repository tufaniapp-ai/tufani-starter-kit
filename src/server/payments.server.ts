/**
 * Paiement : une seule interface pour tous les fournisseurs.
 *
 * L'agrégateur (CinetPay, PayDunya ou accès directs) n'est pas encore choisi.
 * Les écrans et la logique de commande ne parlent qu'à cette interface ; le
 * vrai fournisseur sera une nouvelle implémentation, sans rien changer ailleurs.
 *
 * Règle de sécurité : un billet n'est émis que sur `verify` côté serveur,
 * jamais sur un retour du navigateur. Les clés restent dans ce fichier serveur.
 */

export type PaymentMethod = "orange_money" | "wave" | "moov_money" | "carte";

export type PaymentStatus = "en_attente" | "payee" | "echouee" | "expiree" | "remboursee";

export type InitiateInput = {
  /** Référence unique de la commande : sert de clé d'idempotence chez le fournisseur. */
  orderRef: string;
  amount: number;
  method: PaymentMethod;
  /** Numéro mobile money au format +223XXXXXXXX (inutile pour la carte). */
  payerPhone?: string;
};

export type InitiateResult = {
  providerRef: string;
  status: "en_attente";
  /** Lien de redirection (Wave, carte) ; absent pour une demande poussée sur le téléphone. */
  redirectUrl?: string;
};

export type VerifyResult = {
  providerRef: string;
  status: PaymentStatus;
  amount: number;
  failureReason?: "solde_insuffisant" | "refus_client" | "delai_depasse" | "autre";
};

export interface PaymentProvider {
  readonly name: string;
  initiate(input: InitiateInput): Promise<InitiateResult>;
  verify(providerRef: string): Promise<VerifyResult>;
  refund(providerRef: string, amount: number): Promise<{ status: "remboursee" | "echouee" }>;
}

/**
 * Simulateur pour le développement et les tests.
 * Comportement piloté par le montant, pour tester chaque cas sans vrai argent :
 * se termine par 1 → solde insuffisant, par 2 → reste en attente, sinon payé.
 */
export class SimulatedPaymentProvider implements PaymentProvider {
  readonly name = "simulateur";
  private payments = new Map<string, { orderRef: string; amount: number; status: PaymentStatus }>();

  async initiate(input: InitiateInput): Promise<InitiateResult> {
    if (!Number.isInteger(input.amount) || input.amount <= 0) throw new Error("Montant invalide");
    const existing = [...this.payments.entries()].find(([, p]) => p.orderRef === input.orderRef);
    if (existing) return { providerRef: existing[0], status: "en_attente" };

    // La référence porte le montant : la vérification marche même sur une autre instance du serveur.
    const providerRef = `SIM-${input.orderRef}-${input.amount}`;
    this.payments.set(providerRef, {
      orderRef: input.orderRef,
      amount: input.amount,
      status: simulatedStatus(input.amount),
    });
    // Le vrai Wave renvoie un lien de paiement ; le simulateur valide directement.
    return { providerRef, status: "en_attente" };
  }

  async verify(providerRef: string): Promise<VerifyResult> {
    const amount = Number(/^SIM-.+-(\d+)$/.exec(providerRef)?.[1] ?? NaN);
    const p =
      this.payments.get(providerRef) ??
      (Number.isInteger(amount) && amount > 0
        ? { orderRef: "", amount, status: simulatedStatus(amount) }
        : null);
    if (!p) return { providerRef, status: "echouee", amount: 0, failureReason: "autre" };
    return p.status === "echouee"
      ? { providerRef, status: p.status, amount: p.amount, failureReason: "solde_insuffisant" }
      : { providerRef, status: p.status, amount: p.amount };
  }

  async refund(providerRef: string, amount: number) {
    const p = this.payments.get(providerRef);
    if (!p || p.status !== "payee" || amount > p.amount) return { status: "echouee" as const };
    p.status = "remboursee";
    return { status: "remboursee" as const };
  }
}

/** Montant finissant par 1 → refusé (solde insuffisant), par 2 → reste en attente, sinon payé. */
function simulatedStatus(amount: number): PaymentStatus {
  const last = amount % 10;
  return last === 1 ? "echouee" : last === 2 ? "en_attente" : "payee";
}

let provider: PaymentProvider | null = null;

/** Point d'entrée unique. Tant qu'aucun fournisseur réel n'est configuré, c'est le simulateur. */
export function getPaymentProvider(): PaymentProvider {
  provider ??= new SimulatedPaymentProvider();
  return provider;
}
