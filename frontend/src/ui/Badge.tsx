import type { ReactNode } from "react";
import { cx } from "./cx";
import styles from "./Badge.module.css";

export type BadgeTone = "neutral" | "mark" | "ink" | "pen";

export interface BadgeProps {
  tone?: BadgeTone;
  /** Leading status dot. `pulse` animates it for live states. */
  dot?: boolean | "pulse";
  children: ReactNode;
  className?: string;
  title?: string;
}

/**
 * Tone mapping: mark = pending or in progress, ink = done or healthy,
 * pen = live, attention or failure, neutral = inactive or informational.
 */
export function Badge({ tone = "neutral", dot, children, className, title }: BadgeProps) {
  return (
    <span className={cx(styles.badge, styles[tone], className)} title={title}>
      {dot && <span className={cx(styles.dot, dot === "pulse" && styles.pulse)} aria-hidden="true" />}
      {children}
    </span>
  );
}
