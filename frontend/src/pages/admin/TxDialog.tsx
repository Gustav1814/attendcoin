import type { ReactNode } from "react";
import { useTx, type RunOptions } from "@/lib/tx";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { TxStatus } from "@/ui/TxStatus";
import styles from "./shared.module.css";

export interface TxDialogProps {
  title: ReactNode;
  description?: ReactNode;
  doneTitle?: ReactNode;
  doneDescription?: ReactNode;
  confirmLabel: string;
  tone?: "primary" | "danger";
  /** Noun phrase for the transaction, e.g. "Pause the store". */
  txLabel: string;
  send: RunOptions<unknown>["send"];
  disabled?: boolean;
  onClose: () => void;
  children?: ReactNode;
}

/** Confirmation for a single admin transaction, with its progress shown in place. */
export function TxDialog({
  title,
  description,
  doneTitle,
  doneDescription,
  confirmLabel,
  tone = "primary",
  txLabel,
  send,
  disabled,
  onClose,
  children,
}: TxDialogProps) {
  const tx = useTx();
  const done = tx.state.phase === "confirmed";
  return (
    <Dialog
      open
      size="md"
      onClose={() => !tx.busy && onClose()}
      dismissible={!tx.busy}
      title={done ? (doneTitle ?? title) : title}
      description={done ? (doneDescription ?? description) : description}
      footer={
        done ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={tx.busy}>
              Cancel
            </Button>
            <Button
              variant={tone}
              loading={tx.busy}
              disabled={disabled}
              onClick={() => void tx.run({ label: txLabel, quiet: true, send })}
            >
              {tx.state.phase === "failed" ? "Try again" : confirmLabel}
            </Button>
          </>
        )
      }
    >
      <div className={styles.dialogBody}>
        {!done && children}
        <TxStatus state={tx.state} />
      </div>
    </Dialog>
  );
}
