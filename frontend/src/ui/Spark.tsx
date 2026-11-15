import { useId } from "react";
import { cx } from "./cx";
import styles from "./Spark.module.css";

type Tone = "mark" | "ink" | "pen" | "neutral";

export interface SparklineProps {
  values: number[];
  label: string;
  tone?: Tone;
  height?: number;
  className?: string;
}

/** Line and soft area for a short series. Needs at least two points. */
export function Sparkline({ values, label, tone = "ink", height = 36, className }: SparklineProps) {
  const gradientId = useId();
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 2;
  const x = (i: number) => (i / (values.length - 1)) * 100;
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(2)} ${y(v).toFixed(2)}`).join(" ");
  const last = values[values.length - 1];

  return (
    <div className={cx(styles.spark, styles[tone], className)} style={{ height }} role="img" aria-label={label}>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.22" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line} L100 ${height} L0 ${height} Z`} fill={`url(#${gradientId})`} />
        <path d={line} className={styles.line} />
      </svg>
      <span className={styles.end} style={{ top: y(last) }} aria-hidden="true" />
    </div>
  );
}

export interface BarsProps {
  /** One bar per value. Null draws an empty slot. */
  values: Array<number | null>;
  /** Value that fills the full height. Defaults to the largest value. */
  max?: number;
  label: string;
  tone?: Tone;
  height?: number;
  /** Bar to draw in full colour, e.g. the latest. Others are dimmed. */
  highlight?: number;
  /** Tooltip per bar. */
  titles?: string[];
  className?: string;
}

export function Bars({ values, max, label, tone = "ink", height = 36, highlight, titles, className }: BarsProps) {
  const top = max ?? Math.max(1, ...values.map((v) => v ?? 0));
  return (
    <div className={cx(styles.bars, styles[tone], className)} style={{ height }} role="img" aria-label={label}>
      {values.map((v, i) => (
        <span
          key={i}
          className={cx(styles.bar, v == null && styles.slot, highlight != null && i !== highlight && styles.dim)}
          style={{ height: v == null ? undefined : `${Math.max(6, (v / top) * 100)}%` }}
          title={titles?.[i]}
        />
      ))}
    </div>
  );
}
