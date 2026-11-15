import { Wallet } from "ethers";
import { KeyRound } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { CourseMeta } from "@/lib/api";
import type { CourseView } from "@/lib/contracts";
import { formatTime } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { useTx } from "@/lib/tx";
import { useContracts, useWallet } from "@/lib/wallet";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { TxStatus } from "@/ui/TxStatus";
import { courseTitle, useLimits } from "./data";
import { forgetPendingKey, rememberPendingKey, saveSessionKey } from "./storage";
import styles from "./OpenSessionDialog.module.css";

const PRESETS = [15, 30, 60, 90];

export interface OpenSessionDialogProps {
  course: CourseView;
  meta: CourseMeta | null;
  open: boolean;
  onClose: () => void;
}

export function OpenSessionDialog({ course, meta, open, onClose }: OpenSessionDialogProps) {
  const [minutes, setMinutes] = useState(60);
  const limits = useLimits();
  const { read } = useContracts();
  const { provider } = useWallet();
  const tx = useTx();
  const navigate = useNavigate();
  const now = Math.floor(useNow(open ? 1000 : 0) / 1000);

  const closesAt = now + minutes * 60;
  const working = tx.state.phase === "signing" || tx.state.phase === "pending";

  const close = () => {
    if (working) return;
    tx.reset();
    onClose();
  };

  const submit = async () => {
    if (!read || !provider) return;
    const ephemeral = Wallet.createRandom();
    rememberPendingKey(ephemeral);
    const sessionId = await tx.run({
      label: `Open ${course.code} session`,
      quiet: true,
      send: ({ contracts }) => contracts.manager.openSession(course.id, minutes * 60, ephemeral.address),
      onConfirmed: async ({ hash }) => {
        const receipt = await provider.getTransactionReceipt(hash);
        for (const log of receipt?.logs ?? []) {
          const parsed = read.manager.interface.parseLog(log);
          if (parsed?.name === "SessionOpened") return parsed.args.sessionId as bigint;
        }
        return null;
      },
    });
    if (sessionId) {
      saveSessionKey(sessionId, ephemeral);
      tx.reset();
      onClose();
      navigate(`/teacher/sessions/${sessionId}`);
    } else if (sessionId === null) {
      // Mined, but the event couldn't be read back. The pending key is found
      // again by its address once the session shows up in the course list.
      tx.reset();
      onClose();
    } else {
      forgetPendingKey(ephemeral.address);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      dismissible={!working}
      title="Open a session"
      description={courseTitle(course, meta)}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={working}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={working} disabled={!read || !provider}>
            Open for {minutes} min
          </Button>
        </>
      }
    >
      <fieldset className={styles.presets}>
        <legend className={styles.legend}>Check-in window</legend>
        <div className={styles.options}>
          {PRESETS.map((m) => (
            <label key={m} className={styles.option}>
              <input
                type="radio"
                name="session-duration"
                value={m}
                checked={minutes === m}
                onChange={() => setMinutes(m)}
                disabled={working}
              />
              <span className="t-num">{m}</span>
              <span className={styles.unit}>min</span>
            </label>
          ))}
        </div>
      </fieldset>

      <dl className={styles.timeline}>
        <div>
          <dt>Scanning closes</dt>
          <dd className="t-num">{formatTime(closesAt)}</dd>
        </div>
        <div>
          <dt>Last submission</dt>
          <dd className="t-num">{formatTime(closesAt + limits.grace)}</dd>
        </div>
        <div>
          <dt>Next session from</dt>
          <dd className="t-num">{formatTime(now + limits.gap)}</dd>
        </div>
      </dl>

      <p className={styles.note}>
        <KeyRound size={16} aria-hidden="true" />
        <span>
          The QR codes are signed by a key that lives only in this browser tab. Close the tab and the codes
          can&rsquo;t be shown again. You can still submit, mark students by hand and finalize.
        </span>
      </p>

      {tx.state.phase !== "idle" && (
        <TxStatus state={tx.state} onRetry={submit} onDismiss={tx.reset} className={styles.status} />
      )}
    </Dialog>
  );
}
