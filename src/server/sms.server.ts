/**
 * SMS : une seule interface pour tous les fournisseurs (billets, codes de
 * connexion, rappels, retards). Le fournisseur n'est pas encore choisi ;
 * en attendant, le simulateur garde les messages en mémoire.
 *
 * Un SMS tient en 160 caractères sans accents spéciaux coûteux : on le vérifie
 * ici pour que chaque message reste à 1 crédit.
 */

export type SmsMessage = { to: string; body: string };

export interface SmsProvider {
  readonly name: string;
  send(message: SmsMessage): Promise<{ id: string; status: "envoye" | "echoue" }>;
}

export const SMS_MAX_LENGTH = 160;

export function assertSmsLength(body: string): void {
  if (body.length > SMS_MAX_LENGTH) {
    throw new Error(`SMS trop long (${body.length}/${SMS_MAX_LENGTH}) : ${body.slice(0, 40)}…`);
  }
}

export class SimulatedSmsProvider implements SmsProvider {
  readonly name = "simulateur";
  readonly outbox: (SmsMessage & { id: string; at: Date })[] = [];

  async send(message: SmsMessage) {
    assertSmsLength(message.body);
    const id = `SMS-${this.outbox.length + 1}`;
    this.outbox.push({ ...message, id, at: new Date() });
    return { id, status: "envoye" as const };
  }
}

let provider: SmsProvider | null = null;

export function getSmsProvider(): SmsProvider {
  provider ??= new SimulatedSmsProvider();
  return provider;
}
