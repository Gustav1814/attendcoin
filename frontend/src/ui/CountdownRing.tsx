import type { ReactNode } from "react";
import { cx } from "./cx";
import styles from "./CountdownRing.module.css";

export interface CountdownRingProps {
  /** Length of one cycle in ms. */
  durationMs: number;
  /** Change this to restart the ring, e.g. the ticket's issuedAt. */
  cycleKey: string | number;
  /** Ms already elapsed in the current cycle when it mounts. */
  elapsedMs?: number;
  size?: number;
  stroke?: number;
  tone?: "mark" | "ink" | "pen";
  /** Centre content, typically the seconds left. */
  children?: ReactNode;
  className?: string;
}

/**
 * The sweep is a CSS animation so it stays smooth without re-rendering every
 * frame. Under reduced motion the ring stays full and only the centre updates.
 */
export function CountdownRing({
  durationMs,
  cycleKey,
  elapsedMs = 0,
  size = 40,
  stroke = 2.5,
  tone = "mark",
  children,
  className,
}: CountdownRingProps) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className={cx(styles.ring, className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className={styles.track} cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" />
        <circle
          key={cycleKey}
          className={cx(styles.sweep, styles[tone])}
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={c}
          style={
            {
              "--circ": `${c}px`,
              animationDuration: `${durationMs}ms`,
              animationDelay: `${-elapsedMs}ms`,
            } as React.CSSProperties
          }
        />
      </svg>
      {children != null && <span className={cx(styles.center, "t-num")}>{children}</span>}
    </span>
  );
}
