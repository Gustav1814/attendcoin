import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { REJECT_REASONS, type SessionView } from "@/lib/contracts";
import { pluralize, shortAddress } from "@/lib/format";
import { useTx } from "@/lib/tx";
import { useContracts, useWallet } from "@/lib/wallet";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { EmptyState } from "@/ui/EmptyState";
import { Input } from "@/ui/Field";
import { useToast } from "@/ui/Toast";
import { TxStatus } from "@/ui/TxStatus";
import { chunk, displayName, readOutcome, type RosterStudent } from "./data";
import styles from "./ManualMarkDialog.module.css";

export interface ManualMarkDialogProps {
  open: boolean;
  onClose: () => void;
  session: SessionView;
  roster: RosterStudent[];
  /** Student ids already recorded for this session. */
  attended: Set<string>;
  /** Lower-cased wallets with a check-in waiting in the relay queue. */
  queued: Set<string>;
  maxBatch: number;
}

export function ManualMarkDialog({ open, onClose, session, roster, attended, queued, maxBatch }: ManualMarkDialogProps) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const tx = useTx();
  const toast = useToast();
  const { read } = useContracts();
  const { provider } = useWallet();

  const absent = useMemo(() => roster.filter((s) => !attended.has(s.id.toString())), [roster, attended]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return absent;
    return absent.filter((s) => s.name?.toLowerCase().includes(q) || s.wallet.toLowerCase().includes(q));
  }, [absent, query]);

  const reasonFor = (s: RosterStudent) => {
    if (!s.active) return "Deactivated";
    if (queued.has(s.wallet.toLowerCase())) return "Checked in, not yet submitted";
    return null;
  };
  const selectable = shown.filter((s) => !reasonFor(s));
  const allShownPicked = selectable.length > 0 && selectable.every((s) => picked.has(s.id.toString()));
  const working = tx.state.phase === "signing" || tx.state.phase === "pending";

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleShown = () =>
    setPicked((prev) => {
      const next = new Set(prev);
      for (const s of selectable) {
        if (allShownPicked) next.delete(s.id.toString());
        else next.add(s.id.toString());
      }
      return next;
    });

  const close = () => {
    if (working) return;
    setPicked(new Set());
    setQuery("");
    tx.reset();
    onClose();
  };

  const submit = async () => {
    if (!read || !provider) return;
    // Someone may have been recorded while the dialog was open.
    const ids = [...picked].filter((id) => !attended.has(id)).map(BigInt);
    const batches = chunk(ids, maxBatch);
    let recorded = 0;
    const refused: string[] = [];
    for (const [i, batch] of batches.entries()) {
      const outcome = await tx.run({
        label: batches.length > 1 ? `Mark present (${i + 1} of ${batches.length})` : "Mark present",
        quiet: true,
        send: ({ contracts }) => contracts.manager.markManual(session.id, batch),
        onConfirmed: ({ hash }) => readOutcome(read.manager, provider, hash),
      });
      if (!outcome) return;
      recorded += outcome.recorded.length;
      for (const r of outcome.rejected) {
        const who = roster.find((s) => s.wallet.toLowerCase() === r.student.toLowerCase());
        refused.push(`${who ? displayName(who) : shortAddress(r.student)}: ${REJECT_REASONS[r.reason] ?? "Rejected"}`);
      }
    }
    toast.push({
      tone: refused.length ? "neutral" : "success",
      title: `${pluralize(recorded, "student")} marked present`,
      body: refused.length ? refused.join(". ") : undefined,
    });
    close();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      dismissible={!working}
      size="md"
      title="Mark present by hand"
      description="For students who were here but couldn't scan. Each mark is flagged as manual on-chain."
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={working}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={working} disabled={picked.size === 0}>
            {picked.size ? `Mark ${pluralize(picked.size, "student")}` : "Mark present"}
          </Button>
        </>
      }
    >
      {absent.length === 0 ? (
        <EmptyState compact title="Everyone is in" body="Every enrolled student is already recorded for this session." />
      ) : (
        <>
          <div className={styles.toolbar}>
            <Input
              type="search"
              aria-label="Filter students"
              placeholder="Name or wallet"
              prefix={<Search size={14} aria-hidden="true" />}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Button size="sm" variant="ghost" onClick={toggleShown} disabled={selectable.length === 0 || working}>
              {allShownPicked ? "Clear shown" : "Select shown"}
            </Button>
          </div>

          <ul className={styles.list} aria-label="Students not yet recorded">
            {shown.map((s) => {
              const id = s.id.toString();
              const reason = reasonFor(s);
              return (
                <li key={id}>
                  <label className={styles.row} data-disabled={reason ? "" : undefined}>
                    <input
                      type="checkbox"
                      checked={picked.has(id)}
                      disabled={Boolean(reason) || working}
                      onChange={() => toggle(id)}
                    />
                    <span className={styles.who}>
                      <span className={styles.name}>{s.name ?? "Unnamed"}</span>
                      <span className="t-mono t-muted">{shortAddress(s.wallet)}</span>
                    </span>
                    {reason && <span className={styles.reason}>{reason}</span>}
                  </label>
                </li>
              );
            })}
            {shown.length === 0 && <li className={styles.none}>No one matches &ldquo;{query}&rdquo;.</li>}
          </ul>
        </>
      )}

      {tx.state.phase !== "idle" && (
        <TxStatus state={tx.state} onRetry={submit} onDismiss={tx.reset} className={styles.status} />
      )}
    </Dialog>
  );
}
