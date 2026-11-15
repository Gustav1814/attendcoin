import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { cx } from "./cx";
import { Skeleton } from "./Skeleton";
import styles from "./QrCode.module.css";

export interface QrCodeProps {
  value: string;
  /** Rendered size in CSS pixels. The SVG scales cleanly beyond this. */
  size?: number;
  /** Accessible description, e.g. "Check-in code for CS101". */
  label: string;
  className?: string;
}

/**
 * Dark modules on a light tile: inverted codes look sleeker on black but many
 * phone cameras refuse to read them.
 */
export function QrCode({ value, size = 240, label, className }: QrCodeProps) {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toString(value, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 0,
      color: { dark: "#000000", light: "#00000000" },
    })
      .then((out) => {
        if (!cancelled) setSvg(out);
      })
      .catch(() => {
        if (!cancelled) setSvg(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value]);

  return (
    <div className={cx(styles.tile, className)} style={{ width: size, height: size }} role="img" aria-label={label}>
      {svg ? (
        <div className={styles.code} dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <Skeleton width="100%" height="100%" radius={8} />
      )}
    </div>
  );
}
