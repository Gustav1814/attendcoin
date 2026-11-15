import type { ReactNode } from "react";
import { useCountUp } from "@/lib/hooks";
import { cx } from "./cx";
import { Skeleton } from "./Skeleton";
import styles from "./Stat.module.css";

export type StatTone = "default" | "mark" | "ink" | "pen";

export interface StatProps {
  label: ReactNode;
  /**
   * Numeric values count up once on first load; pass `format` to control how
   * they render. Strings render as-is.
   */
  value: number | string | null | undefined;
  format?: (n: number) => string;
  unit?: ReactNode;
  /** Small line under the value, e.g. "+25 ATC this week" or "of 12 sessions". */
  delta?: ReactNode;
  deltaTone?: "up" | "down" | "neutral";
  tone?: StatTone;
  size?: "md" | "lg" | "xl";
  /** Small chart under the value, e.g. a Sparkline built from history. */
  chart?: ReactNode;
  loading?: boolean;
  className?: string;
}

const defaultFormat = (n: number) => Math.round(n).toLocaleString("en-US");

export function Stat({
  label,
  value,
  format = defaultFormat,
  unit,
  delta,
  deltaTone = "neutral",
  tone = "default",
  size = "md",
  chart,
  loading,
  className,
}: StatProps) {
  const numeric = typeof value === "number" ? value : null;
  const animated = useCountUp(numeric);
  const display = typeof value === "string" ? value : animated == null ? "—" : format(animated);

  return (
    <div className={cx(styles.stat, styles[size], className)} data-tone={tone}>
      <dt className={styles.label}>{label}</dt>
      <dd className={styles.valueRow}>
        {loading ? (
          <Skeleton className={styles.skeleton} />
        ) : (
          <>
            <span
              className={cx(styles.value, "t-num", tone !== "default" && styles[tone])}
              aria-hidden={numeric != null || undefined}
            >
              {display}
            </span>
            {unit && <span className={styles.unit}>{unit}</span>}
            {numeric != null && <span className="visually-hidden">{format(numeric)}</span>}
          </>
        )}
      </dd>
      {delta && !loading && <dd className={cx(styles.delta, styles[deltaTone])}>{delta}</dd>}
      {chart && !loading && <dd className={styles.chart}>{chart}</dd>}
    </div>
  );
}

/**
 * Wraps a row of Stats in a description list so labels and values are announced
 * together. `strip` draws them as ruled cells on one panel.
 */
export function StatGroup({ children, strip, className }: { children: ReactNode; strip?: boolean; className?: string }) {
  return <dl className={cx(styles.group, strip && styles.strip, className)}>{children}</dl>;
}
