import { useQuery } from "@tanstack/react-query";
import { ExternalLink, ScanLine } from "lucide-react";
import { api } from "@/lib/api";
import { explorerTxUrl } from "@/lib/contracts";
import { atcToNumber, formatAtc, formatDateTime, formatPercent, formatRelative, formatTime, pluralize, ratio, shortHash } from "@/lib/format";
import { useWallet } from "@/lib/wallet";
import { Badge } from "@/ui/Badge";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { Meter, StepMeter } from "@/ui/Meter";
import { Page, PageHeader, Stack } from "@/ui/Page";
import { Panel } from "@/ui/Panel";
import { Bars, Sparkline } from "@/ui/Spark";
import { Stat, StatGroup } from "@/ui/Stat";
import { Table, type Column } from "@/ui/Table";
import {
  courseLabel,
  useAtcBalance,
  useAttendanceHistory,
  useRewardRules,
  useSessionIndex,
  useStudentCourses,
  type AttendanceEntry,
  type StudentCourse,
} from "./data";
import styles from "./Overview.module.css";

const formatBalance = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

export function Overview() {
  const { address } = useWallet();
  const balance = useAtcBalance();
  const rules = useRewardRules();
  const courses = useStudentCourses();
  const history = useAttendanceHistory(10);
  const sessions = useSessionIndex(history.data?.map((h) => h.sessionId) ?? []);
  const profile = useQuery({
    queryKey: ["profile", address],
    enabled: Boolean(address),
    staleTime: 5 * 60_000,
    queryFn: () => api.profile(address!).catch(() => null),
  });

  const rows = courses.data ?? [];
  const totalSessions = rows.reduce((n, r) => n + r.course.sessionCount, 0);
  const totalAttended = rows.reduce((n, r) => n + r.stats.attended, 0);
  const bestCurrent = rows.reduce<StudentCourse | null>(
    (best, r) => (!best || r.currentStreak > best.currentStreak ? r : best),
    null,
  );
  const bestEver = rows.reduce((n, r) => Math.max(n, r.stats.bestStreak), 0);
  const length = rules.data?.length ?? 5;
  const live = rows.filter((r) => r.latest?.accepting && !r.latest.attended);
  const courseById = new Map(rows.map((r) => [r.course.id.toString(), r]));

  const nextBonus = bestCurrent ? length - (bestCurrent.currentStreak % length) : length;

  // History arrives newest first; charts read left to right, oldest first.
  const recent = [...(history.data ?? [])].reverse();
  const earnedEach = recent.map((h) => atcToNumber(h.reward + h.bonus));
  const earnedRunning = earnedEach.reduce<number[]>((acc, n) => [...acc, (acc[acc.length - 1] ?? 0) + n], [0]);
  const earnedTotal = earnedRunning[earnedRunning.length - 1];
  const statsLoading = courses.isLoading || rules.isLoading;

  const courseColumns: Column<StudentCourse>[] = [
    {
      key: "course",
      header: "Course",
      render: (r) => (
        <div className={styles.courseCell}>
          <span className={styles.courseCode}>{r.course.code}</span>
          {r.meta?.title && <span className={styles.courseTitle}>{r.meta.title}</span>}
        </div>
      ),
    },
    {
      key: "attended",
      header: "Attended",
      numeric: true,
      align: "right",
      render: (r) => (
        <span>
          {r.stats.attended}
          <span className="t-muted"> / {r.course.sessionCount}</span>
        </span>
      ),
    },
    {
      key: "rate",
      header: "Rate",
      width: "22%",
      hideOnMobile: true,
      render: (r) => {
        const rate = ratio(r.stats.attended, r.course.sessionCount);
        return (
          <div className={styles.rate}>
            <Meter value={rate} label={`${r.course.code} attendance`} />
            <span className="t-num">{formatPercent(rate)}</span>
          </div>
        );
      },
    },
    {
      key: "streak",
      header: "Streak",
      numeric: true,
      align: "right",
      render: (r) => (
        <span className={styles.nowrap}>
          <span className={r.currentStreak > 0 ? "t-pen" : undefined}>{r.currentStreak}</span>
          <span className="t-muted"> · best {r.stats.bestStreak}</span>
        </span>
      ),
    },
    {
      key: "bonus",
      header: "Next bonus",
      hideOnMobile: true,
      render: (r) => {
        const progress = r.currentStreak % length;
        const left = length - progress;
        return (
          <div className={styles.bonus}>
            <StepMeter total={length} filled={progress} label={`${r.course.code}: ${progress} of ${length} toward the bonus`} />
            <span className="t-muted">in {pluralize(left, "session")}</span>
          </div>
        );
      },
    },
  ];

  const historyColumns: Column<AttendanceEntry>[] = [
    {
      key: "when",
      header: "When",
      render: (h) =>
        h.timestamp ? (
          <time dateTime={new Date(h.timestamp * 1000).toISOString()} title={formatDateTime(h.timestamp)}>
            {formatRelative(h.timestamp)}
          </time>
        ) : (
          <span className="t-muted">Block {h.blockNumber}</span>
        ),
    },
    {
      key: "course",
      header: "Session",
      render: (h) => {
        const course = courseById.get(h.courseId.toString())?.course;
        const index = sessions.data?.get(h.sessionId.toString())?.index;
        return (
          <span className={styles.nowrap}>
            {course?.code ?? `Course ${h.courseId}`}
            <span className="t-muted"> · {index ? `#${index}` : `session ${h.sessionId}`}</span>
            {h.manual && (
              <Badge tone="neutral" className={styles.inlineBadge}>
                Manual
              </Badge>
            )}
          </span>
        );
      },
    },
    {
      key: "earned",
      header: "Earned (ATC)",
      align: "right",
      numeric: true,
      render: (h) => (
        <span>
          <span className="t-mark">+{formatAtc(h.reward, { symbol: false })}</span>
          {h.bonus > 0n && <span className="t-pen"> +{formatAtc(h.bonus, { symbol: false })} bonus</span>}
        </span>
      ),
    },
    {
      key: "streak",
      header: "Streak",
      align: "right",
      numeric: true,
      hideOnMobile: true,
      render: (h) => h.streak,
    },
    {
      key: "tx",
      header: <span className="visually-hidden">Transaction</span>,
      align: "right",
      hideOnMobile: true,
      render: (h) => {
        const url = explorerTxUrl(h.txHash);
        return url ? (
          <a href={url} target="_blank" rel="noreferrer" className="link t-mono" aria-label="View transaction on explorer">
            {shortHash(h.txHash)} <ExternalLink size={12} aria-hidden="true" />
          </a>
        ) : (
          <span className="t-mono t-muted">{shortHash(h.txHash)}</span>
        );
      },
    },
  ];

  return (
    <Page>
      <PageHeader
        eyebrow={profile.data?.name ?? "Student"}
        title="Overview"
        actions={
          <Button to="/student/checkin" leading={<ScanLine size={16} aria-hidden="true" />} className={styles.headerCta}>
            Check in
          </Button>
        }
      />

      <Stack gap={8}>
        {live.length > 0 && (
          <div className={styles.live} role="status">
            {live.map((r) => (
              <div key={r.course.id.toString()} className={styles.liveRow}>
                <Badge tone="pen" dot="pulse" className={styles.liveBadge}>
                  Open now
                </Badge>
                <p className={styles.liveText}>
                  <strong>{courseLabel(r.course, r.meta)}</strong>, session {r.latest!.index}. Closes at{" "}
                  {formatTime(r.latest!.closesAt)}.
                </p>
                <Button size="sm" to="/student/checkin">
                  Check in
                </Button>
              </div>
            ))}
          </div>
        )}

        <StatGroup strip className={styles.stats}>
          <Stat
            label="Balance"
            size="xl"
            tone="mark"
            unit="ATC"
            loading={balance.isLoading}
            value={balance.data != null ? atcToNumber(balance.data) : null}
            format={formatBalance}
            delta={recent.length > 1 ? `+${formatBalance(earnedTotal)} ATC from the last ${recent.length} check-ins` : undefined}
            chart={
              recent.length > 1 ? (
                <Sparkline
                  values={earnedRunning}
                  tone="mark"
                  height={44}
                  label={`ATC earned over the last ${recent.length} check-ins`}
                />
              ) : undefined
            }
          />
          <Stat
            label="Attendance"
            tone="ink"
            size="lg"
            loading={statsLoading}
            value={totalSessions ? formatPercent(ratio(totalAttended, totalSessions)) : "—"}
            delta={totalSessions ? `${totalAttended} of ${pluralize(totalSessions, "session")}` : "No sessions yet"}
            chart={
              rows.length > 1 ? (
                <Bars
                  values={rows.map((r) => ratio(r.stats.attended, r.course.sessionCount) ?? 0)}
                  max={1}
                  tone="ink"
                  height={28}
                  titles={rows.map((r) => `${r.course.code}: ${formatPercent(ratio(r.stats.attended, r.course.sessionCount))}`)}
                  label="Attendance rate by course"
                />
              ) : undefined
            }
          />
          <Stat
            label="Current streak"
            tone="pen"
            size="lg"
            loading={statsLoading}
            value={bestCurrent?.currentStreak ?? 0}
            delta={`Best ${bestEver}`}
            chart={
              recent.length > 1 ? (
                <Bars
                  values={recent.map((h) => h.streak)}
                  tone="pen"
                  height={28}
                  highlight={recent.length - 1}
                  titles={recent.map((h) => `Streak ${h.streak}`)}
                  label={`Streak at each of the last ${recent.length} check-ins`}
                />
              ) : undefined
            }
          />
          <Stat
            label="Next bonus"
            size="lg"
            loading={statsLoading}
            value={rows.length ? nextBonus : "—"}
            unit={rows.length ? (nextBonus === 1 ? "session" : "sessions") : undefined}
            delta={
              rules.data && bestCurrent ? (
                <span className={styles.nextBonus}>
                  <StepMeter
                    total={length}
                    filled={bestCurrent.currentStreak % length}
                    label={`${bestCurrent.currentStreak % length} of ${length} sessions toward the next bonus`}
                  />
                  +{formatAtc(rules.data.bonus, { symbol: true })} in {bestCurrent.course.code}
                </span>
              ) : undefined
            }
          />
        </StatGroup>

        <Panel title="Courses" flush>
          {courses.error ? (
            <EmptyState
              tone="danger"
              compact
              title="Couldn't load your courses"
              body="The blockchain node didn't respond."
              action={
                <Button size="sm" variant="secondary" onClick={() => void courses.refetch()}>
                  Try again
                </Button>
              }
            />
          ) : (
            <Table
              label="Your courses"
              columns={courseColumns}
              rows={courses.data}
              loading={courses.isLoading}
              rowKey={(r) => r.course.id.toString()}
              empty={
                <EmptyState
                  compact
                  title="No courses yet"
                  body="You'll see courses here once a teacher or admin enrolls this wallet."
                />
              }
            />
          )}
        </Panel>

        <Panel title="Recent attendance" description="Rewards paid to this wallet, newest first." flush>
          {history.error ? (
            <EmptyState
              tone="danger"
              compact
              title="Couldn't load attendance history"
              body="Reading past events from the chain failed. Your balance and courses above are unaffected."
              action={
                <Button size="sm" variant="secondary" onClick={() => void history.refetch()}>
                  Try again
                </Button>
              }
            />
          ) : (
            <Table
              label="Recent attendance"
              columns={historyColumns}
              rows={history.data}
              loading={history.isLoading}
              rowKey={(h) => h.key}
              empty={<EmptyState compact title="No attendance yet" body="Check in at your next class to earn ATC." />}
            />
          )}
        </Panel>
      </Stack>
    </Page>
  );
}
