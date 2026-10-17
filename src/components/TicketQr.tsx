import QRCode from "qrcode";
import { useEffect, useState } from "react";

/** QR code d'un billet (texte signé), dessiné dans le navigateur, imprimable. */
export function TicketQr({
  value,
  size = 168,
  label,
}: {
  value: string;
  size?: number;
  label: string;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void QRCode.toDataURL(value, { errorCorrectionLevel: "M", margin: 1, width: size }).then(
      (url) => {
        if (alive) setSrc(url);
      },
    );
    return () => {
      alive = false;
    };
  }, [value, size]);

  if (!src)
    return (
      <div
        style={{ width: size, height: size }}
        className="rounded-lg bg-secondary"
        aria-hidden="true"
      />
    );
  return <img src={src} width={size} height={size} alt={label} className="rounded-lg" />;
}
