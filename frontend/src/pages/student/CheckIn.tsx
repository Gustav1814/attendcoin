import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CircleAlert, Clock } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import type { EventLog } from "ethers";
import { api } from "@/lib/api";
import { REJECT_REASONS, deployment, chain, logsFromBlock, readCourse, readSession } from "@/lib/contracts";
import { attendanceDomain, parseCheckinPayload, recoverTicketSigner, signCheckIn, type Ticket } from "@/lib/eip712";
import { describeError } from "@/lib/errors";
import { formatAtc, formatTime } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { useRoles } from "@/lib/roles";
import { useChainKey, useContracts, useWallet } from "@/lib/wallet";
import { Button } from "@/ui/Button";
import { CountdownRing } from "@/ui/CountdownRing";
import { Field, Input } from "@/ui/Field";
import { Page, PageHeader } from "@/ui/Page";
import { Scanner } from "@/ui/Scanner";
import { LoadingRegion, SkeletonText } from "@/ui/Skeleton";
import { cx } from "@/ui/cx";
import { courseLabel, useRewardRules } from "./data";
import styles from "./CheckIn.module.css";

/** The backend refuses tickets older than this. */
const TICKET_TTL_S = 30;
const POLL_MS = 3000;

/**
 * One screen for both entry points: a camera deep link (/checkin?s=&t=&sig=)
 * and the in-app scanner (/student/checkin). A valid ticket in the URL skips
 * straight to confirmation.
 */
export function CheckIn() {
  const [params, setParams] = useSearchParams();
  const hasParams = params.has("s") || params.has("sig");
  const ticket = useMemo(() => parseCheckinPayload(params), [params]);

  const clear = useCallback(() => setParams({}, { replace: true }), [setParams]);

  return (
    <Page width="narrow">
      <PageHeader eyebrow="Student" title="Check in" />
      {ticket ? (
        <TicketFlow key={`${ticket.sessionId}-${ticket.issuedAt}`} ticket={ticket} onRescan={clear} />
      ) : (
        <ScanStep
          invalidLink={hasParams}
          onTicket={(t) =>
            setParams({ s: t.sessionId.toString(), t: String(t.issuedAt), sig: t.ticketSig }, { replace: true })
          }
        />
      )}
    </Page>
  );
}

function ScanStep({ onTicket, invalidLink }: { onTicket: (t: Ticket) => void; invalidLink: boolean }) {
  const [hint, setHint] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);

  const onResult = (text: string) => {
    const t = parseCheckinPayload(text);
    if (!t) {
      setHint("That isn't an AttendCoin check-in code.");
      return false;
    }
    onTicket(t);
    return true;
  };

  const onPaste = (e: FormEvent) => {
    e.preventDefault();
    const t = parseCheckinPayload(pasted);
    if (!t) {
      setPasteError("That link doesn't contain a check-in code. It should include s, t and sig.");
      return;
    }
    onTicket(t);
  };

  return (
    <div className={styles.stack}>
      {invalidLink && (
        <Notice tone="pen" icon={<CircleAlert size={18} />} title="That link isn't a valid check-in code">
          It may have been cut off when it was copied. Scan the code on the screen instead.
        </Notice>
      )}
      <p className={styles.lede}>Scan the code your teacher is showing. Codes refresh every few seconds, so scan the current one.</p>
      <Scanner onResult={onResult} hint={hint} label="Check-in code scanner" />
      <form className={styles.paste} onSubmit={onPaste}>
        <Field label="Or paste a check-in link" error={pasteError}>
          <Input
            value={pasted}
            onChange={(e) => {
              setPasted(e.target.value);
              setPasteError(null);
            }}
            placeholder="https://…/checkin?s=…"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            mono
          />
        </Field>
        <Button type="submit" variant="secondary" disabled={!pasted.trim()}>
          Use link
        </Button>
      </form>
    </div>
  );
}

type Phase =
  | { kind: "ready" }
  | { kind: "signing" }
  | { kind: "submitting" }
  | { kind: "queued"; since: number }
  | { kind: "recorded"; earlier?: boolean }
  | { kind: "rejected"; reason: string }
  | { kind: "failed"; title: string; message: string };

function TicketFlow({ ticket, onRescan }: { ticket: Ticket; onRescan: () => void }) {
  const { signer, address } = useWallet();
  const { read } = useContracts();
  const { studentId } = useRoles();
  const rules = useRewardRules();
  const key = useChainKey();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>({ kind: "ready" });
  const domain = useMemo(
    () => attendanceDomain(chain.chainId, deployment!.contracts.AttendanceManager),
    [],
  );

  const session = useQuery({
    queryKey: [...key, "checkin-session", ticket.sessionId.toString(), ticket.ticketSig],
    enabled: Boolean(read && studentId > 0n),
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const { manager } = read!;
      const count = await manager.sessionCount();
      if (ticket.sessionId === 0n || ticket.sessionId > count) return { valid: false as const };
      const s = await readSession(manager, ticket.sessionId);
      const [course, accepting, enrolled, attended, meta] = await Promise.all([
        readCourse(manager, s.courseId),
        manager.isAcceptingAttendance(s.id),
        manager.isEnrolled(s.courseId, studentId),
        manager.attended(s.id, studentId),
        api.courseMeta(s.courseId).catch(() => null),
      ]);
      let signerMatches = false;
      try {
        signerMatches = recoverTicketSigner(domain, ticket).toLowerCase() === s.signer.toLowerCase();
      } catch {
        signerMatches = false;
      }
      return { valid: true as const, session: s, course, meta, accepting, enrolled, attended, signerMatches };
    },
  });

  const waiting = phase.kind === "ready" || phase.kind === "signing";
  const now = useNow(waiting ? 250 : phase.kind === "queued" ? 5000 : 0);
  // Clamp to zero: a phone clock running slightly behind the teacher's shouldn't block anyone.
  const ageMs = Math.max(0, now - ticket.issuedAt * 1000);
  const remaining = Math.max(0, Math.ceil(TICKET_TTL_S - ageMs / 1000));
  const stale = ageMs > TICKET_TTL_S * 1000;

  const alreadyRecorded = session.data?.valid && session.data.attended;
  useEffect(() => {
    if (alreadyRecorded && phase.kind === "ready") setPhase({ kind: "recorded", earlier: true });
  }, [alreadyRecorded, phase.kind]);

  // While queued, ask the backend for status and watch the chain directly; whichever answers first wins.
  const polls = useRef(0);
  useEffect(() => {
    if (phase.kind !== "queued" || !read || !address) return;
    let cancelled = false;
    polls.current = 0;
    const tick = async () => {
      polls.current += 1;
      try {
        const [onChain, status] = await Promise.all([
          read.manager.attended(ticket.sessionId, studentId),
          api.checkInStatus(ticket.sessionId, address).catch(() => null),
        ]);
        if (cancelled) return;
        if (onChain || status?.status === "recorded") {
          setPhase({ kind: "recorded" });
          void queryClient.invalidateQueries({ queryKey: ["chain"] });
          return;
        }
        // The relayer drops a check-in from the queue once it's been sent; if it's gone
        // and not attended, the contract rejected it and logged why.
        if (status?.status === "none" && polls.current > 1) {
          const reason = await findRejection(read.manager, ticket.sessionId, address, logsFromBlock);
          if (!cancelled && reason) {
            setPhase({ kind: "rejected", reason });
            return;
          }
        }
      } catch {
        // transient; the next tick retries
      }
      if (!cancelled) timer = window.setTimeout(tick, POLL_MS);
    };
    let timer = window.setTimeout(tick, 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [phase.kind, read, address, ticket.sessionId, studentId, queryClient]);

  const submit = async () => {
    if (!signer || !address) return;
    setPhase({ kind: "signing" });
    try {
      const studentSig = await signCheckIn(signer, domain, {
        sessionId: ticket.sessionId,
        student: address,
        issuedAt: ticket.issuedAt,
        ticketSig: ticket.ticketSig,
      });
      if (Date.now() - ticket.issuedAt * 1000 > TICKET_TTL_S * 1000) {
        setPhase({ kind: "ready" });
        return;
      }
      setPhase({ kind: "submitting" });
      await api.submitCheckIn({
        sessionId: ticket.sessionId.toString(),
        student: address,
        issuedAt: ticket.issuedAt,
        ticketSig: ticket.ticketSig,
        studentSig,
      });
      setPhase({ kind: "queued", since: Date.now() });
    } catch (err) {
      const e = describeError(err);
      if (e.rejected) {
        setPhase({ kind: "ready" });
        return;
      }
      setPhase({ kind: "failed", title: e.title === "Request failed" ? "Check-in refused" : e.title, message: e.message });
    }
  };

  if (session.isLoading) {
    return (
      <LoadingRegion label="Reading the session">
        <SkeletonText lines={4} />
      </LoadingRegion>
    );
  }

  if (session.error || !session.data) {
    return (
      <Notice
        tone="pen"
        icon={<CircleAlert size={18} />}
        title="Couldn't read this session"
        action={<Button onClick={() => void session.refetch()}>Try again</Button>}
      >
        The blockchain node didn&rsquo;t respond.
      </Notice>
    );
  }

  const data = session.data;
  if (!data.valid || !data.signerMatches) {
    return (
      <Blocked onRescan={onRescan} title="This code isn't valid">
        It wasn&rsquo;t issued for an AttendCoin session on {chain.name}. Scan the code on your teacher&rsquo;s screen.
      </Blocked>
    );
  }

  const label = courseLabel(data.course, data.meta);
  const summary = (
    <div className={styles.session}>
      <p className={styles.course}>{label}</p>
      <p className={styles.sessionMeta}>
        Session {data.session.index}
        {data.accepting && <> · open until {formatTime(data.session.closesAt)}</>}
      </p>
    </div>
  );

  if (phase.kind === "recorded") {
    return (
      <div className={styles.stack}>
        <div className={cx(styles.result, styles.ok)} role="status" aria-live="polite">
          <span className={styles.resultIcon} aria-hidden="true">
            <Check size={16} strokeWidth={2} />
            Recorded on chain
          </span>
          <h2 className={cx(styles.resultTitle, "t-display")}>You&rsquo;re checked in</h2>
          {summary}
          {rules.data && !phase.earlier && (
            <p className={styles.reward}>
              <span className="t-mark t-num">+{formatAtc(rules.data.reward, { symbol: true })}</span> added to your balance
            </p>
          )}
          {phase.earlier && <p className={styles.sessionMeta}>Your attendance for this session was already recorded.</p>}
        </div>
        <Button to="/student" variant="secondary" size="lg" full>
          Back to overview
        </Button>
      </div>
    );
  }

  if (!data.enrolled) {
    return (
      <Blocked onRescan={onRescan} title="You're not enrolled in this course">
        {label} doesn&rsquo;t list this wallet. Ask your teacher to enroll you, then scan again.
      </Blocked>
    );
  }

  if (!data.accepting && (phase.kind === "ready" || phase.kind === "signing")) {
    return (
      <Blocked onRescan={onRescan} title="This session is closed" summary={summary}>
        Attendance for this session is no longer being taken. If you were there, ask your teacher to record you manually.
      </Blocked>
    );
  }

  if (phase.kind === "queued" || phase.kind === "submitting") {
    const slow = phase.kind === "queued" && now - phase.since > 60_000;
    return (
      <div className={styles.stack}>
        <div className={styles.result} role="status" aria-live="polite">
          <span className={styles.resultIcon} aria-hidden="true">
            <Clock size={16} strokeWidth={2} />
            {phase.kind === "submitting" ? "Submitting" : "Queued"}
          </span>
          <h2 className={cx(styles.resultTitle, "t-display")}>
            {phase.kind === "submitting" ? "Sending…" : "Check-in received"}
          </h2>
          {summary}
          <p className={styles.sessionMeta}>
            {slow
              ? "Still waiting for the chain. It's safe to leave; your attendance will show on your overview once it's recorded."
              : "Your teacher sends the class's check-ins to the chain. This page updates when yours is recorded."}
          </p>
        </div>
        <Button to="/student" variant="ghost" full>
          Back to overview
        </Button>
      </div>
    );
  }

  if (phase.kind === "rejected" || phase.kind === "failed") {
    return (
      <Blocked
        onRescan={onRescan}
        summary={summary}
        title={phase.kind === "rejected" ? "Check-in wasn't recorded" : phase.title}
      >
        {phase.kind === "rejected" ? `The contract rejected it: ${phase.reason.toLowerCase()}.` : phase.message}
      </Blocked>
    );
  }

  if (stale) {
    return (
      <Blocked onRescan={onRescan} title="This code has expired" summary={summary}>
        Codes are valid for {TICKET_TTL_S} seconds. Scan the one on the screen now.
      </Blocked>
    );
  }

  const signing = phase.kind === "signing";
  const urgent = remaining <= 8;
  return (
    <div className={styles.stack}>
      <div className={styles.confirm}>
        {summary}
        <CountdownRing
          durationMs={TICKET_TTL_S * 1000}
          elapsedMs={ageMs}
          cycleKey={ticket.issuedAt}
          size={56}
          stroke={3}
          tone={urgent ? "pen" : "mark"}
        >
          <span aria-hidden="true">{remaining}</span>
        </CountdownRing>
      </div>
      <p className="visually-hidden" aria-live="polite">
        {remaining === 10 ? "Ten seconds left to sign." : ""}
      </p>
      <p className={styles.lede}>
        Signing proves this wallet is here. It&rsquo;s free and doesn&rsquo;t send a transaction.
      </p>
      <Button size="lg" full onClick={submit} loading={signing} disabled={!signer}>
        {signing ? "Confirm in your wallet" : "Sign and check in"}
      </Button>
      <Button variant="ghost" full onClick={onRescan} disabled={signing}>
        Scan a different code
      </Button>
    </div>
  );
}

type ManagerLike = NonNullable<ReturnType<typeof useContracts>["read"]>["manager"];

async function findRejection(
  manager: ManagerLike,
  sessionId: bigint,
  student: string,
  fromBlock: typeof logsFromBlock,
): Promise<string | null> {
  const provider = manager.runner?.provider;
  if (!provider) return null;
  const from = await fromBlock(provider);
  const logs = (await manager.queryFilter(manager.filters.CheckInRejected(sessionId, student), from)) as EventLog[];
  const last = logs.at(-1);
  if (!last || !("args" in last)) return null;
  return REJECT_REASONS[Number(last.args.reason)] ?? "Unknown reason";
}

function Notice({
  tone,
  icon,
  title,
  action,
  children,
}: {
  tone: "pen" | "ink";
  icon: ReactNode;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={cx(styles.notice, styles[tone])} role={tone === "pen" ? "alert" : "status"}>
      <span className={styles.noticeIcon} aria-hidden="true">
        {icon}
      </span>
      <div>
        <p className={styles.noticeTitle}>{title}</p>
        <p className={styles.noticeBody}>{children}</p>
        {action && <div className={styles.noticeAction}>{action}</div>}
      </div>
    </div>
  );
}

function Blocked({
  title,
  summary,
  onRescan,
  children,
}: {
  title: string;
  summary?: ReactNode;
  onRescan: () => void;
  children: ReactNode;
}) {
  return (
    <div className={styles.stack}>
      {summary}
      <Notice tone="pen" icon={<CircleAlert size={18} />} title={title}>
        {children}
      </Notice>
      <Button size="lg" full onClick={onRescan}>
        Scan again
      </Button>
    </div>
  );
}
