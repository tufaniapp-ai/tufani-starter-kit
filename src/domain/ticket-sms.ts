/**
 * Texte du billet envoyé par SMS : sans accents (1 seul crédit SMS), moins de 160 caractères,
 * avec le code que le contrôleur peut saisir à la main.
 */

import { addMinutes } from "./guichet";

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

export function ticketSms(t: {
  company: string;
  from: string;
  to: string;
  date: string;
  time: string;
  minutes: number;
  seat: number;
  code: string;
}): string {
  const [, m = "", d = ""] = t.date.split("-");
  const at = addMinutes(t.time, t.minutes);
  const text = `Tufani ${plain(t.company).slice(0, 24)} : ${plain(t.from)} ${d}/${m} ${at} > ${plain(t.to)}, siege ${t.seat}. Billet ${t.code}. Presentez-vous 30 min avant.`;
  return text.length <= 160 ? text : text.slice(0, 160);
}
