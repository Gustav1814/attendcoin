import type { ReactNode } from "react";
import { cx } from "./cx";
import styles from "./EmptyState.module.css";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  /** One or two sentences: why it's empty and what to do next. */
  body?: ReactNode;
  action?: ReactNode;
  tone?: "neutral" | "danger";
  /** Smaller padding when used inside a Panel. */
  compact?: boolean;
  className?: string;
}

export function EmptyState({ icon, title, body, action, tone = "neutral", compact, className }: EmptyStateProps) {
  return (
    <div
      className={cx(styles.empty, compact && styles.compact, tone === "danger" && styles.danger, className)}
      role={tone === "danger" ? "alert" : undefined}
    >
      <div className={styles.icon} aria-hidden="true">
        {icon ?? (tone === "danger" ? <AlertMark /> : <LedgerMark />)}
      </div>
      <div className={styles.copy}>
        <p className={styles.title}>{title}</p>
        {body && <div className={styles.body}>{body}</div>}
      </div>
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}

/** Blank ledger page: the default mark for an empty list. */
function LedgerMark() {
  return (
    <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeLinecap="square">
      <rect x="4.5" y="3.5" width="19" height="21" />
      <path d="M8.5 9.5h11M8.5 13.5h7" />
      <path d="M8.5 18.5h11" strokeDasharray="1 2.5" />
    </svg>
  );
}

function AlertMark() {
  return (
    <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeLinecap="square">
      <rect x="4.5" y="4.5" width="19" height="19" />
      <path d="M14 9.5v6" />
      <path d="M14 19v.5" strokeWidth="2" />
    </svg>
  );
}
