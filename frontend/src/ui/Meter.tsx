import { cx } from "./cx";
import styles from "./Meter.module.css";

export interface MeterProps {
  /** 0 to 1. Null renders an empty track. */
  value: number | null;
  label: string;
  tone?: "ink" | "mark" | "pen";
  /** Optional marker position, 0 to 1, e.g. a target attendance threshold. */
  marker?: number;
  className?: string;
}

export function Meter({ value, label, tone = "ink", marker, className }: MeterProps) {
  const pct = value == null ? 0 : Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      className={cx(styles.track, className)}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value == null ? undefined : pct}
    >
      <span className={cx(styles.fill, styles[tone])} style={{ width: `${pct}%` }} />
      {marker != null && <span className={styles.marker} style={{ left: `${marker * 100}%` }} aria-hidden="true" />}
    </div>
  );
}

/** A row of discrete steps, e.g. sessions toward the next streak bonus. */
export function StepMeter({ total, filled, label, tone = "pen" }: { total: number; filled: number; label: string; tone?: "ink" | "mark" | "pen" }) {
  return (
    <div className={styles.steps} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={filled}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={cx(styles.step, i < filled && styles[tone])} />
      ))}
    </div>
  );
}
