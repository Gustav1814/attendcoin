import type { CSSProperties, ReactNode } from "react";
import { cx } from "./cx";
import styles from "./Skeleton.module.css";

export interface SkeletonProps {
  width?: CSSProperties["width"];
  height?: CSSProperties["height"];
  radius?: CSSProperties["borderRadius"];
  className?: string;
}

export function Skeleton({ width, height = 14, radius, className }: SkeletonProps) {
  return <span className={cx(styles.skeleton, className)} style={{ width, height, borderRadius: radius }} aria-hidden="true" />;
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <span className={cx(styles.text, className)} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? "60%" : "100%"} />
      ))}
    </span>
  );
}

/** Announces loading once to assistive tech while skeletons are on screen. */
export function LoadingRegion({ label = "Loading", children }: { label?: string; children: ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="visually-hidden">{label}</span>
      {children}
    </div>
  );
}
