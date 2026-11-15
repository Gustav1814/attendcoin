import { Check, CircleAlert, ExternalLink } from "lucide-react";
import { explorerTxUrl, isLocalChain } from "@/lib/contracts";
import { shortHash } from "@/lib/format";
import type { TxState } from "@/lib/tx";
import { Button } from "./Button";
import { cx } from "./cx";
import { Spinner } from "./Spinner";
import styles from "./TxStatus.module.css";

export interface TxStatusProps {
  state: TxState;
  onRetry?: () => void;
  onDismiss?: () => void;
  /** Override the line shown while waiting for the wallet. */
  signingHint?: string;
  className?: string;
}

/** Inline progress for one transaction. Renders nothing while idle. */
export function TxStatus({ state, onRetry, onDismiss, signingHint, className }: TxStatusProps) {
  if (state.phase === "idle") return <div role="status" aria-live="polite" className="visually-hidden" />;
  const url = state.hash ? explorerTxUrl(state.hash) : null;

  const hash = state.hash && (
    <span className={styles.hash}>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className={styles.link}>
          <span className="t-mono">{shortHash(state.hash)}</span>
          <ExternalLink size={12} aria-hidden="true" />
        </a>
      ) : (
        <span className="t-mono" title={isLocalChain ? "Local chain: no block explorer" : undefined}>
          {shortHash(state.hash)}
        </span>
      )}
    </span>
  );

  return (
    <div
      className={cx(styles.status, styles[state.phase], className)}
      role={state.phase === "failed" ? "alert" : "status"}
      aria-live={state.phase === "failed" ? "assertive" : "polite"}
    >
      <span className={styles.icon} aria-hidden="true">
        {state.phase === "confirmed" ? (
          <Check size={16} />
        ) : state.phase === "failed" ? (
          <CircleAlert size={16} />
        ) : (
          <Spinner size={14} />
        )}
      </span>
      <div className={styles.copy}>
        <p className={styles.title}>
          {state.phase === "signing" && (signingHint ?? "Confirm in your wallet")}
          {state.phase === "pending" && `${state.label}: waiting for the block`}
          {state.phase === "confirmed" && `${state.label}: confirmed`}
          {state.phase === "failed" && (state.error?.title ?? "Transaction failed")}
        </p>
        <p className={styles.detail}>
          {state.phase === "signing" && state.label}
          {state.phase === "pending" && hash}
          {state.phase === "confirmed" && (
            <>
              Block <span className="t-num">{state.blockNumber?.toLocaleString("en-US")}</span>
              {hash && <> · {hash}</>}
            </>
          )}
          {state.phase === "failed" && (
            <>
              {state.error?.message}
              {hash && <> · {hash}</>}
            </>
          )}
        </p>
      </div>
      {(state.phase === "failed" || state.phase === "confirmed") && (onRetry || onDismiss) && (
        <div className={styles.actions}>
          {state.phase === "failed" && onRetry && (
            <Button size="sm" variant="secondary" onClick={onRetry}>
              Try again
            </Button>
          )}
          {onDismiss && (
            <Button size="sm" variant="ghost" onClick={onDismiss}>
              Dismiss
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
