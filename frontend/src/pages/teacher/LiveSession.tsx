import { CircleSlash, KeyRound, Maximize, Minimize, RotateCw, ScanLine, Send, UserCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Wallet } from "ethers";
import type { QueuedCheckIn } from "@/lib/api";
import { chain, deployment, REJECT_REASONS, type SessionView } from "@/lib/contracts";
import { attendanceDomain, buildCheckinUrl, signTicket } from "@/lib/eip712";
import { formatDuration, formatTime, nowSeconds, pluralize, ratio, shortAddress } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { useTx } from "@/lib/tx";
import { useContracts, useWallet } from "@/lib/wallet";
import { Badge } from "@/ui/Badge";
import { cx } from "@/ui/cx";
import { Button } from "@/ui/Button";
import { CountdownRing } from "@/ui/CountdownRing";
import { Dialog } from "@/ui/Dialog";
import { EmptyState } from "@/ui/EmptyState";
import { Meter } from "@/ui/Meter";
import { QrCode } from "@/ui/QrCode";
import { Skeleton } from "@/ui/Skeleton";
import { TxStatus } from "@/ui/TxStatus";
import {
  chunk,
  courseTitle,
  readOutcome,
  useLimits,
  useRoster,
  useSessionQueue,
  useSessionRecords,
  type SessionDetail,
} from "./data";
import { ManualMarkDialog } from "./ManualMarkDialog";
import { BackLink, PhaseBadge, sessionPhase } from "./parts";
import { forgetSessionKey, loadRejected, loadSessionKey, saveRejected, type RejectedCheckIn } from "./storage";
import styles from "./LiveSession.module.css";

const ROTATE_MS = 10_000;

interface LiveTicket {
  url: string;
  issuedAt: number;
  /** Wall-clock ms when this code went up, for the ring. */
  at: number;
}

/**
 * Signs a fresh ticket every ten seconds until the scan window closes. The
 * relay rejects stale tickets, so a photo of the screen stops working quickly.
 */
function useRotatingTicket(session: SessionView, key: Wallet | null) {
  const [ticket, setTicket] = useState<LiveTicket | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!key || !deployment) return;
    const domain = attendanceDomain(chain.chainId, deployment.contracts.AttendanceManager);
    let cancelled = false;
    let timer: number | undefined;

    const tick = async () => {
      const now = nowSeconds();
      if (now > session.closesAt) {
        setTicket(null);
        return;
      }
      const issuedAt = Math.max(session.openedAt, now);
      try {
        const ticketSig = await signTicket(key, domain, session.id, issuedAt);
        if (cancelled) return;
        setFailed(false);
        setTicket({
          issuedAt,
          at: Date.now(),
          url: buildCheckinUrl(window.location.origin, { sessionId: session.id, issuedAt, ticketSig }),
        });
      } catch {
        if (!cancelled) setFailed(true);
      }
      if (!cancelled) timer = window.setTimeout(tick, ROTATE_MS);
    };

    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [key, session.id, session.openedAt, session.closesAt]);

  return { ticket, failed };
}

function useFullscreen<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [active, setActive] = useState(false);
  const supported = typeof document !== "undefined" && document.fullscreenEnabled;

  useEffect(() => {
    const sync = () => setActive(document.fullscreenElement != null && document.fullscreenElement === ref.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const toggle = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void ref.current?.requestFullscreen().catch(() => undefined);
  }, []);

  return { ref, active, supported, toggle };
}

interface Arrival {
  key: string;
  name: string;
  wallet: string;
  state: "queued" | "recorded" | "manual";
}

interface BatchResult {
  recorded: number;
  rejected: RejectedCheckIn[];
}

export function LiveSession({ detail }: { detail: SessionDetail }) {
  const { session, course, meta } = detail;
  const now = Math.floor(useNow(1000) / 1000);
  const scanning = now <= session.closesAt;
  const limits = useLimits();
  const roster = useRoster(course.id);
  const records = useSessionRecords(session.id, true);
  const queue = useSessionQueue(session.id, true);
  const tx = useTx();
  const { read } = useContracts();
  const { provider } = useWallet();
  const fullscreen = useFullscreen<HTMLDivElement>();

  const key = useMemo(() => loadSessionKey(session.id, session.signer), [session.id, session.signer]);
  const { ticket, failed } = useRotatingTicket(session, key);
  const [rejected, setRejected] = useState<RejectedCheckIn[]>(() => loadRejected(session.id));
  const [result, setResult] = useState<BatchResult | null>(null);
  const [marking, setMarking] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [busy, setBusy] = useState(false);

  const rosterByWallet = useMemo(
    () => new Map((roster.data ?? []).map((s) => [s.wallet.toLowerCase(), s])),
    [roster.data],
  );
  const recorded = records.data ?? [];
  const recordedWallets = useMemo(() => new Set(recorded.map((r) => r.wallet.toLowerCase())), [recorded]);
  const attendedIds = useMemo(() => new Set(recorded.map((r) => r.studentId.toString())), [recorded]);
  const rejectedSigs = useMemo(() => new Set(rejected.map((r) => r.ticketSig)), [rejected]);

  const pending = useMemo(
    () =>
      (queue.data ?? []).filter(
        (e) => !rejectedSigs.has(e.ticketSig) && !recordedWallets.has(e.student.toLowerCase()),
      ),
    [queue.data, rejectedSigs, recordedWallets],
  );
  const queuedWallets = useMemo(() => new Set(pending.map((e) => e.student.toLowerCase())), [pending]);

  const nameOf = (wallet: string, fallback?: string | null) =>
    fallback || rosterByWallet.get(wallet.toLowerCase())?.name || shortAddress(wallet);

  const arrivals: Arrival[] = [
    ...[...pending]
      .sort((a, b) => b.issuedAt - a.issuedAt)
      .map((e) => ({ key: e.ticketSig, name: nameOf(e.student, e.name), wallet: e.student, state: "queued" as const })),
    ...[...recorded]
      .sort((a, b) => b.blockNumber - a.blockNumber)
      .map((r) => ({
        key: r.key,
        name: nameOf(r.wallet),
        wallet: r.wallet,
        state: r.manual ? ("manual" as const) : ("recorded" as const),
      })),
  ];

  const recordedCount = Math.max(recorded.length, session.attendeeCount);
  const checkedIn = recordedCount + pending.length;
  const enrolled = course.enrolledCount;
  const phase = sessionPhase(session, true, now);
  const submitBy = session.closesAt + limits.grace;
  const working = busy || tx.state.phase === "signing" || tx.state.phase === "pending";

  const submit = async () => {
    if (!read || !provider || pending.length === 0) return;
    const batches = chunk(pending, limits.maxBatch);
    let accepted = 0;
    const refused: RejectedCheckIn[] = [];
    setBusy(true);
    setResult(null);
    try {
      for (const [i, batch] of batches.entries()) {
        const outcome = await tx.run({
          label: batches.length > 1 ? `Submit check-ins (${i + 1} of ${batches.length})` : "Submit check-ins",
          quiet: true,
          send: ({ contracts }) => contracts.manager.submitCheckIns(session.id, batch.map(toCheckIn)),
          onConfirmed: ({ hash }) => readOutcome(read.manager, provider, hash),
        });
        if (!outcome) break;
        accepted += outcome.recorded.length;
        for (const r of outcome.rejected) {
          const entry = batch.find((e) => e.student.toLowerCase() === r.student.toLowerCase());
          if (!entry) continue;
          refused.push({
            ticketSig: entry.ticketSig,
            student: entry.student,
            name: entry.name ?? rosterByWallet.get(entry.student.toLowerCase())?.name ?? null,
            reason: r.reason,
          });
        }
      }
    } finally {
      setBusy(false);
    }
    if (refused.length) {
      const next = [...rejected, ...refused];
      setRejected(next);
      saveRejected(session.id, next);
    }
    if (accepted || refused.length) setResult({ recorded: accepted, rejected: refused });
  };

  const finalize = async () => {
    const done = await tx.run({
      label: `Finalize ${course.code} session #${session.index}`,
      send: ({ contracts }) => contracts.manager.finalizeSession(session.id),
      onConfirmed: () => true,
    });
    if (done) {
      forgetSessionKey(session.id);
      setFinalizing(false);
    }
  };

  const title = courseTitle(course, meta);

  return (
    <div ref={fullscreen.ref} className={styles.root} data-fullscreen={fullscreen.active || undefined}>
      <div className={styles.inner}>
        <header className={styles.head}>
          <div className={styles.heading}>
            <div className={styles.back}>
              <BackLink to={`/teacher/courses/${course.id}`}>{course.code}</BackLink>
            </div>
            <p className={styles.eyebrow}>
              <PhaseBadge phase={phase} />
              <span className="t-num">Session #{session.index}</span>
            </p>
            <h1 className={styles.title}>{title}</h1>
          </div>
          {fullscreen.supported && (
            <Button
              variant="ghost"
              onClick={fullscreen.toggle}
              leading={fullscreen.active ? <Minimize size={16} /> : <Maximize size={16} />}
              className={styles.fsButton}
            >
              {fullscreen.active ? "Exit full screen" : "Full screen"}
            </Button>
          )}
        </header>

        <div className={styles.layout}>
          <section className={styles.stage} aria-label="Check-in code">
            <Stage
              scanning={scanning}
              hasKey={key != null}
              failed={failed}
              ticket={ticket}
              closesAt={session.closesAt}
              submitBy={submitBy}
              label={`Check-in code for ${course.code} session ${session.index}`}
            />
            <div className={styles.clock}>
              {scanning ? (
                <>
                  <span className={styles.clockLabel}>Closes in</span>
                  <span className={styles.clockValue}>{formatDuration(session.closesAt - now)}</span>
                </>
              ) : (
                <>
                  <span className={styles.clockLabel}>Submit by {formatTime(submitBy)}</span>
                  <span className={styles.clockValue}>{formatDuration(submitBy - now)}</span>
                </>
              )}
            </div>
          </section>

          <aside className={styles.side} aria-label="Check-ins">
            <div className={styles.count}>
              <p className={styles.countValue}>
                <span className="t-num">{checkedIn}</span>
                <span className={styles.countOf}>/ {enrolled}</span>
              </p>
              <p className={styles.countLabel}>checked in</p>
              <Meter value={ratio(checkedIn, enrolled)} label="Share of enrolled students checked in" />
              <dl className={styles.breakdown}>
                <div className={styles.cell}>
                  <dt className={styles.cellLabel}>Waiting</dt>
                  <dd className={cx(styles.cellValue, "t-mark t-num")}>{pending.length}</dd>
                </div>
                <div className={styles.cell}>
                  <dt className={styles.cellLabel}>Recorded</dt>
                  <dd className={cx(styles.cellValue, "t-ink t-num")}>{recordedCount}</dd>
                </div>
                <div className={styles.cell}>
                  <dt className={styles.cellLabel}>Rejected</dt>
                  <dd className={cx(styles.cellValue, "t-num", rejected.length > 0 && "t-pen")}>{rejected.length}</dd>
                </div>
              </dl>
              <span className="visually-hidden" aria-live="polite">
                {`${checkedIn} of ${enrolled} checked in, ${pending.length} waiting to be submitted`}
              </span>
              {queue.isError && (
                <p className={styles.relayDown} role="alert">
                  Can&rsquo;t reach the check-in relay. Scans will show up once it&rsquo;s back.
                </p>
              )}
            </div>

            <div className={styles.controls}>
              <Button
                variant="primary"
                size="lg"
                full
                onClick={submit}
                loading={working && !marking && !finalizing}
                disabled={pending.length === 0 || limits.paused || working}
                leading={<Send size={16} />}
              >
                {pending.length ? `Submit ${pluralize(pending.length, "check-in")}` : "Nothing to submit"}
              </Button>
              {pending.length > limits.maxBatch && (
                <p className={styles.hint}>
                  Goes out in {Math.ceil(pending.length / limits.maxBatch)} transactions of up to {limits.maxBatch}.
                </p>
              )}
              <div className={styles.secondary}>
                <Button
                  onClick={() => setMarking(true)}
                  disabled={limits.paused || working || !roster.data}
                  leading={<UserCheck size={16} />}
                >
                  Mark by hand
                </Button>
                <Button variant="danger" onClick={() => setFinalizing(true)} disabled={working}>
                  Finalize
                </Button>
              </div>
              {limits.paused && (
                <p className={styles.hint}>The contract is paused. Submitting resumes when an admin unpauses it.</p>
              )}
              {tx.state.phase !== "idle" && !marking && !finalizing && (
                <TxStatus state={tx.state} onRetry={submit} onDismiss={tx.reset} />
              )}
              {result && <BatchSummary result={result} />}
            </div>

            <ArrivalList arrivals={arrivals} loading={records.isLoading || queue.isLoading} />

            {rejected.length > 0 && (
              <div className={styles.rejected}>
                <h2 className={styles.sectionTitle}>Rejected</h2>
                <ul className={styles.rejectedList}>
                  {rejected.map((r) => (
                    <li key={r.ticketSig}>
                      <span>{r.name ?? shortAddress(r.student)}</span>
                      <span className="t-pen">{REJECT_REASONS[r.reason] ?? "Rejected"}</span>
                    </li>
                  ))}
                </ul>
                <p className={styles.hint}>If they were really here, mark them by hand.</p>
              </div>
            )}
          </aside>
        </div>
      </div>

      {roster.data && (
        <ManualMarkDialog
          open={marking}
          onClose={() => setMarking(false)}
          session={session}
          roster={roster.data}
          attended={attendedIds}
          queued={queuedWallets}
          maxBatch={limits.maxBatch}
        />
      )}

      <Dialog
        open={finalizing}
        onClose={() => !working && setFinalizing(false)}
        dismissible={!working}
        title={`Finalize session #${session.index}?`}
        description="Finalizing locks attendance for this session. Nothing can be added afterwards."
        footer={
          <>
            <Button variant="ghost" onClick={() => setFinalizing(false)} disabled={working}>
              Keep open
            </Button>
            <Button variant="danger" onClick={finalize} loading={working}>
              Finalize
            </Button>
          </>
        }
      >
        <ul className={styles.finalizeNotes}>
          {scanning && <li>Scanning stops now, {formatDuration(session.closesAt - now)} early.</li>}
          {pending.length > 0 && (
            <li className="t-pen">
              {pluralize(pending.length, "check-in")} still waiting. Submit {pending.length === 1 ? "it" : "them"} first
              or {pending.length === 1 ? "it is" : "they are"} lost.
            </li>
          )}
          <li>
            {pluralize(recordedCount, "student")} recorded out of {enrolled}.
          </li>
        </ul>
        {tx.state.phase !== "idle" && finalizing && <TxStatus state={tx.state} onRetry={finalize} onDismiss={tx.reset} />}
      </Dialog>
    </div>
  );
}

function toCheckIn(e: QueuedCheckIn) {
  return { student: e.student, issuedAt: e.issuedAt, ticketSig: e.ticketSig, studentSig: e.studentSig };
}

interface StageProps {
  scanning: boolean;
  hasKey: boolean;
  failed: boolean;
  ticket: LiveTicket | null;
  closesAt: number;
  submitBy: number;
  label: string;
}

function Stage({ scanning, hasKey, failed, ticket, closesAt, submitBy, label }: StageProps) {
  if (!scanning) {
    return (
      <div className={styles.placeholder}>
        <EmptyState
          icon={<CircleSlash size={20} />}
          title={`Scanning closed at ${formatTime(closesAt)}`}
          body={`Submit what's waiting and mark anyone who couldn't scan before ${formatTime(submitBy)}, then finalize.`}
        />
      </div>
    );
  }
  if (!hasKey) {
    return (
      <div className={styles.placeholder}>
        <EmptyState
          icon={<KeyRound size={20} />}
          title="Codes can't be shown here"
          body="The signing key for this session stayed in the tab that opened it. You can still submit what's queued, mark students by hand and finalize."
        />
      </div>
    );
  }
  if (failed && !ticket) {
    return (
      <div className={styles.placeholder}>
        <EmptyState
          tone="danger"
          icon={<RotateCw size={20} />}
          title="Couldn't sign a code"
          body="Reload the page to try again. The key is kept for this tab."
        />
      </div>
    );
  }
  return (
    <div className={styles.qrWrap}>
      {ticket ? (
        <div className={styles.qrFrame}>
          <QrCode value={ticket.url} size={900} label={label} className={styles.qr} />
        </div>
      ) : (
        <Skeleton width="100%" height="100%" radius="var(--radius-lg)" className={styles.qrSkeleton} />
      )}
      {ticket && <RotationRing at={ticket.at} issuedAt={ticket.issuedAt} />}
    </div>
  );
}

function RotationRing({ at, issuedAt }: { at: number; issuedAt: number }) {
  const now = useNow(250);
  const elapsed = Math.min(ROTATE_MS, Math.max(0, now - at));
  const left = Math.ceil((ROTATE_MS - elapsed) / 1000);
  return (
    <div className={styles.rotation}>
      <CountdownRing durationMs={ROTATE_MS} cycleKey={issuedAt} elapsedMs={elapsed} size={44} stroke={3}>
        {left}
      </CountdownRing>
      <span className={styles.rotationLabel}>New code every 10 seconds</span>
    </div>
  );
}

function BatchSummary({ result }: { result: BatchResult }) {
  return (
    <div className={styles.result} role="status">
      <p>
        <span className="t-ink t-num">{result.recorded}</span> recorded
        {result.rejected.length > 0 && (
          <>
            , <span className="t-pen t-num">{result.rejected.length}</span> rejected
          </>
        )}
      </p>
    </div>
  );
}

function ArrivalList({ arrivals, loading }: { arrivals: Arrival[]; loading: boolean }) {
  return (
    <div className={styles.arrivals}>
      <h2 className={styles.sectionTitle}>
        <span>Arrivals</span>
        {arrivals.length > 0 && <span className="t-num">{arrivals.length}</span>}
      </h2>
      {loading && arrivals.length === 0 ? (
        <div className={styles.arrivalSkeleton}>
          <Skeleton width="60%" />
          <Skeleton width="45%" />
          <Skeleton width="52%" />
        </div>
      ) : arrivals.length === 0 ? (
        <p className={styles.waiting}>
          <ScanLine size={16} strokeWidth={1.5} aria-hidden="true" />
          <span>Waiting for the first scan. Names appear here as students check in.</span>
        </p>
      ) : (
        <ol className={styles.arrivalList}>
          {arrivals.map((a, i) => (
            <li key={a.key} className={styles.arrival}>
              <span className={cx(styles.arrivalIndex, "t-num")}>{String(arrivals.length - i).padStart(2, "0")}</span>
              <span className={styles.arrivalName} title={a.wallet}>
                {a.name}
              </span>
              {a.state === "queued" ? (
                <Badge tone="mark">Waiting</Badge>
              ) : a.state === "manual" ? (
                <Badge tone="ink">Manual</Badge>
              ) : (
                <Badge tone="ink">Recorded</Badge>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
