import { CircleCheck, Download, Lock } from "lucide-react";
import { useMemo } from "react";
import { explorerTxUrl } from "@/lib/contracts";
import {
  formatAtc,
  formatDateTime,
  formatDuration,
  formatPercent,
  formatTime,
  pluralize,
  ratio,
} from "@/lib/format";
import { useTx } from "@/lib/tx";
import { AddressChip } from "@/ui/AddressChip";
import { Badge } from "@/ui/Badge";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { Page, PageHeader, Stack } from "@/ui/Page";
import { Panel } from "@/ui/Panel";
import { Stat } from "@/ui/Stat";
import { Table, type Column } from "@/ui/Table";
import { csvAtc, downloadCsv, fileStamp } from "./csv";
import {
  courseTitle,
  useBlockTimes,
  useRoster,
  useSessionQueue,
  useSessionRecords,
  type AttendanceRecord,
  type SessionDetail,
} from "./data";
import { BackLink, PhaseBadge, sessionPhase } from "./parts";
import parts from "./parts.module.css";
import { loadRejected } from "./storage";
import styles from "./SessionSummary.module.css";

interface AttendeeRow {
  record: AttendanceRecord;
  name: string | null;
  at: number | null;
}

export function SessionSummary({ detail }: { detail: SessionDetail }) {
  const { session, course, meta } = detail;
  const roster = useRoster(course.id);
  const records = useSessionRecords(session.id, false);
  const queue = useSessionQueue(session.id, false);
  const times = useBlockTimes(records.data?.map((r) => r.blockNumber) ?? []);
  const tx = useTx();

  const names = useMemo(
    () => new Map((roster.data ?? []).map((s) => [s.wallet.toLowerCase(), s.name])),
    [roster.data],
  );
  const list = records.data ?? [];
  const attended = new Set(list.map((r) => r.studentId.toString()));
  const rows: AttendeeRow[] = [...list]
    .sort((a, b) => a.blockNumber - b.blockNumber)
    .map((record) => ({
      record,
      name: names.get(record.wallet.toLowerCase()) ?? null,
      at: times.data?.get(record.blockNumber) ?? null,
    }));
  const absent = (roster.data ?? []).filter((s) => !attended.has(s.id.toString()));
  const manual = list.filter((r) => r.manual).length;
  const minted = list.reduce((n, r) => n + r.reward + r.bonus, 0n);

  const rejectedSigs = new Set(loadRejected(session.id).map((r) => r.ticketSig));
  const recordedWallets = new Set(list.map((r) => r.wallet.toLowerCase()));
  const unsubmitted = (queue.data ?? []).filter(
    (e) => !rejectedSigs.has(e.ticketSig) && !recordedWallets.has(e.student.toLowerCase()),
  ).length;

  const phase = sessionPhase(session, false, 0);
  const rate = ratio(session.attendeeCount, course.enrolledCount);

  const finalize = () =>
    tx.run({
      label: `Finalize ${course.code} session #${session.index}`,
      send: ({ contracts }) => contracts.manager.finalizeSession(session.id),
    });

  const columns: Column<AttendeeRow>[] = [
    {
      key: "student",
      header: "Student",
      render: (r) => <AddressChip address={r.record.wallet} name={r.name} />,
    },
    {
      key: "at",
      header: "Recorded",
      numeric: true,
      hideOnMobile: true,
      render: (r) => (r.at ? formatTime(r.at) : <span className="t-muted">Block {r.record.blockNumber}</span>),
    },
    {
      key: "how",
      header: "How",
      render: (r) => (r.record.manual ? <Badge tone="mark">Manual</Badge> : <span className="t-muted">QR</span>),
    },
    {
      key: "streak",
      header: "Streak",
      align: "right",
      numeric: true,
      hideOnMobile: true,
      render: (r) => <span className="t-pen">{r.record.streak}</span>,
    },
    {
      key: "atc",
      header: "ATC",
      align: "right",
      numeric: true,
      render: (r) => (
        <span className={styles.paid}>
          {r.record.bonus > 0n && <Badge tone="pen">Streak bonus</Badge>}
          <span className="t-mark">{formatAtc(r.record.reward + r.record.bonus)}</span>
        </span>
      ),
    },
    {
      key: "tx",
      header: <span className="visually-hidden">Transaction</span>,
      align: "right",
      hideOnMobile: true,
      render: (r) => {
        const url = explorerTxUrl(r.record.txHash);
        return url ? (
          <a className="link" href={url} target="_blank" rel="noreferrer">
            Tx
          </a>
        ) : null;
      },
    },
  ];

  const exportCsv = () =>
    downloadCsv(
      `${course.code}-session-${session.index}-${fileStamp()}.csv`,
      ["Student ID", "Name", "Wallet", "Present", "Manual", "Recorded at", "Streak", "Reward ATC", "Bonus ATC", "Tx"],
      [
        ...rows.map((r) => [
          r.record.studentId.toString(),
          r.name,
          r.record.wallet,
          "yes",
          r.record.manual ? "yes" : "no",
          r.at ? new Date(r.at * 1000).toISOString() : "",
          r.record.streak,
          csvAtc(r.record.reward),
          csvAtc(r.record.bonus),
          r.record.txHash,
        ]),
        ...absent.map((s) => [s.id.toString(), s.name, s.wallet, "no", "", "", "", "", "", ""]),
      ],
    );

  return (
    <Page>
      <BackLink to={`/teacher/courses/${course.id}`}>{course.code}</BackLink>
      <PageHeader
        eyebrow={
          <span className={styles.eyebrow}>
            <span>Session #{session.index}</span>
            <PhaseBadge phase={phase} />
          </span>
        }
        title={courseTitle(course, meta)}
        description={`Opened ${formatDateTime(session.openedAt)} for ${formatDuration(session.closesAt - session.openedAt)}.`}
        actions={
          <>
            <Button onClick={exportCsv} disabled={!records.data || !roster.data} leading={<Download size={16} />}>
              Export CSV
            </Button>
            {!session.finalized && (
              <Button
                variant="danger"
                onClick={finalize}
                loading={tx.state.phase === "signing" || tx.state.phase === "pending"}
                leading={<Lock size={16} />}
              >
                Finalize
              </Button>
            )}
          </>
        }
      />

      <Stack gap={8}>
        {!session.finalized && (
          <p className={styles.notice}>
            Nothing more can be recorded for this session. Finalize it to mark it as done.
          </p>
        )}
        {unsubmitted > 0 && (
          <p className={styles.warning} role="note">
            {pluralize(unsubmitted, "check-in")} reached the relay but {unsubmitted === 1 ? "was" : "were"} never
            submitted, so {unsubmitted === 1 ? "that student was" : "those students were"} not recorded.
          </p>
        )}

        <div className={parts.stats}>
          <Stat label="Present" value={`${session.attendeeCount} / ${course.enrolledCount}`} />
          <Stat label="Turnout" value={formatPercent(rate)} tone="ink" />
          <Stat label="Marked by hand" value={records.data ? manual : null} loading={records.isLoading} />
          <Stat label="ATC minted" value={records.data ? formatAtc(minted) : null} tone="mark" loading={records.isLoading} />
        </div>

        <Panel title="Present" flush>
          <Table
            label="Students recorded for this session"
            columns={columns}
            rows={rows}
            loading={records.isLoading}
            rowKey={(r) => r.record.key}
            empty={<EmptyState compact title="Nobody was recorded" body="No check-ins or manual marks made it on-chain for this session." />}
          />
        </Panel>

        <Panel title="Absent" description={roster.data ? pluralize(absent.length, "student") : undefined}>
          {roster.isLoading ? (
            <p className="t-muted">Loading roster…</p>
          ) : absent.length === 0 ? (
            <p className={styles.full}>
              <CircleCheck size={16} aria-hidden="true" /> Everyone enrolled was here.
            </p>
          ) : (
            <ul className={styles.absent}>
              {absent.map((s) => (
                <li key={s.id.toString()}>
                  <AddressChip address={s.wallet} name={s.name} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </Stack>
    </Page>
  );
}
