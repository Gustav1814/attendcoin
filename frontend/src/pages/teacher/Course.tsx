import { Download, MonitorPlay, Play, RotateCw, Users } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { SessionView, StatsView } from "@/lib/contracts";
import {
  formatAtc,
  formatDateTime,
  formatDuration,
  formatPercent,
  ratio,
} from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { AddressChip } from "@/ui/AddressChip";
import { Badge } from "@/ui/Badge";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { Meter } from "@/ui/Meter";
import { Page, PageHeader, Stack } from "@/ui/Page";
import { Panel } from "@/ui/Panel";
import { Skeleton } from "@/ui/Skeleton";
import { Stat } from "@/ui/Stat";
import { Table, type Column } from "@/ui/Table";
import { Tabs } from "@/ui/Tabs";
import { csvAtc, downloadCsv, fileStamp } from "./csv";
import {
  displayName,
  liveStreak,
  parseId,
  useCourseRecords,
  useCourseStats,
  useLimits,
  useRoster,
  useTeacherCourse,
  type RosterStudent,
  type TeacherCourse,
} from "./data";
import { OpenSessionDialog } from "./OpenSessionDialog";
import { BackLink, PhaseBadge, RowLink, openBlocker, sessionPhase } from "./parts";
import parts from "./parts.module.css";
import styles from "./Course.module.css";

type View = "students" | "sessions";

interface StudentRow {
  student: RosterStudent;
  stats: StatsView | null;
  held: number;
  rate: number | null;
  streak: number;
  manual: number;
  earned: bigint;
}

interface SessionRow {
  session: SessionView;
  manual: number;
  minted: bigint;
}

export function Course() {
  const id = parseId(useParams().courseId);
  const lookup = useTeacherCourse(id);

  if (id == null || lookup.data?.status === "missing") {
    return <Missing title="No such course" body="That course id doesn't exist on this network." />;
  }
  if (lookup.data?.status === "not-yours") {
    return <Missing title="Not your course" body="This course is taught from a different wallet." />;
  }
  if (lookup.isError) {
    return (
      <Page>
        <BackLink to="/teacher">Courses</BackLink>
        <EmptyState
          tone="danger"
          title="Couldn't load this course"
          body="The chain didn't answer. Check the RPC connection and try again."
          action={
            <Button onClick={() => lookup.refetch()} leading={<RotateCw size={14} />}>
              Retry
            </Button>
          }
        />
      </Page>
    );
  }
  return <CourseReport entry={lookup.data?.status === "ok" ? lookup.data.data : null} />;
}

function Missing({ title, body }: { title: string; body: string }) {
  return (
    <Page>
      <BackLink to="/teacher">Courses</BackLink>
      <EmptyState title={title} body={body} action={<Button to="/teacher">Back to courses</Button>} />
    </Page>
  );
}

function CourseReport({ entry }: { entry: TeacherCourse | null }) {
  const courseId = entry?.course.id ?? null;
  const roster = useRoster(courseId);
  const records = useCourseRecords(courseId ? [courseId] : []);
  const stats = useCourseStats(courseId, roster.data?.map((s) => s.id) ?? []);
  const limits = useLimits();
  const now = Math.floor(useNow(1000) / 1000);
  const navigate = useNavigate();
  const [view, setView] = useState<View>("students");
  const [opening, setOpening] = useState(false);

  if (!entry) {
    return (
      <Page>
        <BackLink to="/teacher">Courses</BackLink>
        <div className={styles.loadingHeader} aria-busy="true" aria-label="Loading course">
          <Skeleton width={96} height={14} />
          <Skeleton width="45%" height={40} />
        </div>
        <div className={parts.stats}>
          {["Enrolled", "Sessions", "Avg attendance", "ATC issued"].map((label) => (
            <Stat key={label} label={label} value={null} loading />
          ))}
        </div>
      </Page>
    );
  }

  const { course, meta, sessions, live } = entry;
  const blocker = openBlocker(entry, limits, now);
  const all = records.data ?? [];
  const bySession = groupBy(all, (r) => r.sessionId.toString());
  const byStudent = groupBy(all, (r) => r.studentId.toString());
  const issued = all.reduce((n, r) => n + r.reward + r.bonus, 0n);
  const doneCount = sessions.length - (live ? 1 : 0);

  const studentRows: StudentRow[] = (roster.data ?? []).map((student) => {
    const own = byStudent.get(student.id.toString()) ?? [];
    const s = stats.data?.get(student.id.toString()) ?? null;
    const inLive = live != null && own.some((r) => r.sessionId === live.id);
    // An open session only counts against a student once they've had the chance to attend it.
    const held = doneCount + (inLive ? 1 : 0);
    return {
      student,
      stats: s,
      held,
      rate: s ? ratio(s.attended, held) : null,
      streak: s ? liveStreak(s, sessions.length, live != null) : 0,
      manual: own.filter((r) => r.manual).length,
      earned: own.reduce((n, r) => n + r.reward + r.bonus, 0n),
    };
  });

  const sessionRows: SessionRow[] = [...sessions].reverse().map((session) => {
    const own = bySession.get(session.id.toString()) ?? [];
    return {
      session,
      manual: own.filter((r) => r.manual).length,
      minted: own.reduce((n, r) => n + r.reward + r.bonus, 0n),
    };
  });

  const studentColumns: Column<StudentRow>[] = [
    {
      key: "student",
      header: "Student",
      render: (r) => <AddressChip address={r.student.wallet} name={r.student.name} />,
    },
    {
      key: "attended",
      header: "Attended",
      align: "right",
      numeric: true,
      render: (r) =>
        r.stats ? (
          <span>
            {r.stats.attended}
            <span className="t-muted"> / {r.held}</span>
          </span>
        ) : (
          "—"
        ),
    },
    {
      key: "rate",
      header: "Rate",
      width: "20%",
      hideOnMobile: true,
      render: (r) => (
        <div className={parts.rate}>
          <Meter value={r.rate} label={`${displayName(r.student)} attendance`} />
          <span className="t-num">{formatPercent(r.rate)}</span>
        </div>
      ),
    },
    {
      key: "streak",
      header: "Streak",
      align: "right",
      numeric: true,
      render: (r) =>
        r.stats ? (
          <span>
            <span className={r.streak > 0 ? "t-pen" : undefined}>{r.streak}</span>
            <span className="t-muted"> · best {r.stats.bestStreak}</span>
          </span>
        ) : (
          "—"
        ),
    },
    {
      key: "flags",
      header: "Flags",
      hideOnMobile: true,
      render: (r) => (
        <span className={styles.flags}>
          {r.manual > 0 && (
            <Badge tone="mark" title={`${r.manual} attendance marked by hand`}>
              {r.manual} manual
            </Badge>
          )}
          {!r.student.active && <Badge tone="pen">Deactivated</Badge>}
        </span>
      ),
    },
    {
      key: "earned",
      header: "ATC",
      align: "right",
      numeric: true,
      hideOnMobile: true,
      render: (r) => <span className="t-mark">{formatAtc(r.earned)}</span>,
    },
  ];

  const sessionColumns: Column<SessionRow>[] = [
    {
      key: "index",
      header: "#",
      numeric: true,
      width: "3.5rem",
      render: (r) => r.session.index,
    },
    {
      key: "opened",
      header: "Opened",
      render: (r) => (
        <RowLink to={`/teacher/sessions/${r.session.id}`}>
          <time dateTime={new Date(r.session.openedAt * 1000).toISOString()}>
            {formatDateTime(r.session.openedAt)}
          </time>
        </RowLink>
      ),
    },
    {
      key: "length",
      header: "Window",
      hideOnMobile: true,
      numeric: true,
      render: (r) => formatDuration(r.session.closesAt - r.session.openedAt),
    },
    {
      key: "attendees",
      header: "Present",
      align: "right",
      render: (r) => (
        <span className="t-num">
          {r.session.attendeeCount}
          <span className="t-muted"> / {course.enrolledCount}</span>
        </span>
      ),
    },
    {
      key: "manual",
      header: "Manual",
      align: "right",
      hideOnMobile: true,
      render: (r) => (r.manual ? r.manual : <span className="t-muted">0</span>),
    },
    {
      key: "minted",
      header: "ATC minted",
      align: "right",
      numeric: true,
      hideOnMobile: true,
      render: (r) => <span className="t-mark">{formatAtc(r.minted)}</span>,
    },
    {
      key: "status",
      header: "Status",
      align: "right",
      render: (r) => <PhaseBadge phase={sessionPhase(r.session, r.session === live, now)} />,
    },
  ];

  const exportStudents = () =>
    downloadCsv(
      `${course.code}-students-${fileStamp()}.csv`,
      ["Student ID", "Name", "Wallet", "Active", "Attended", "Held", "Rate %", "Streak", "Best streak", "Manual marks", "ATC earned"],
      studentRows.map((r) => [
        r.student.id.toString(),
        r.student.name,
        r.student.wallet,
        r.student.active ? "yes" : "no",
        r.stats?.attended,
        r.held,
        r.rate == null ? "" : Math.round(r.rate * 1000) / 10,
        r.streak,
        r.stats?.bestStreak,
        r.manual,
        csvAtc(r.earned),
      ]),
    );

  const exportSessions = () =>
    downloadCsv(
      `${course.code}-sessions-${fileStamp()}.csv`,
      ["Session ID", "Number", "Opened", "Closes", "Present", "Enrolled now", "Manual", "ATC minted", "Status"],
      sessionRows.map((r) => [
        r.session.id.toString(),
        r.session.index,
        new Date(r.session.openedAt * 1000).toISOString(),
        new Date(r.session.closesAt * 1000).toISOString(),
        r.session.attendeeCount,
        course.enrolledCount,
        r.manual,
        csvAtc(r.minted),
        sessionPhase(r.session, r.session === live, now),
      ]),
    );

  const details = [meta?.room, meta?.schedule].filter(Boolean).join(" · ");
  const studentsLoading = roster.isLoading || stats.isLoading || records.isLoading;

  return (
    <Page>
      <BackLink to="/teacher">Courses</BackLink>
      <PageHeader
        eyebrow={course.active ? `Course ${course.id}` : `Course ${course.id} · inactive`}
        title={meta?.title ? `${course.code} · ${meta.title}` : course.code}
        description={details || undefined}
        actions={
          live ? (
            <Button variant="primary" to={`/teacher/sessions/${live.id}`} leading={<MonitorPlay size={16} />}>
              {now <= live.closesAt ? "Open screen" : "Submit and finalize"}
            </Button>
          ) : blocker ? (
            <span className={styles.blocked}>{blocker}</span>
          ) : (
            <Button variant="primary" onClick={() => setOpening(true)} leading={<Play size={16} />}>
              Open session
            </Button>
          )
        }
      />

      <Stack gap={8}>
        <div className={parts.stats}>
          <Stat label="Enrolled" value={course.enrolledCount} />
          <Stat label="Sessions" value={sessions.length} />
          <Stat label="Avg attendance" value={formatPercent(entry.attendance)} tone="ink" />
          <Stat label="ATC issued" value={records.data ? formatAtc(issued) : null} tone="mark" loading={records.isLoading} />
        </div>

        <Tabs
          label="Course report"
          value={view}
          onChange={setView}
          items={[
            { value: "students", label: "Students", count: course.enrolledCount },
            { value: "sessions", label: "Sessions", count: sessions.length },
          ]}
        >
          {view === "students" ? (
            <Panel
              flush
              title="Attendance by student"
              description={live ? "The open session counts once a student has checked in to it." : undefined}
              actions={
                <Button
                  size="sm"
                  onClick={exportStudents}
                  disabled={!studentRows.length || studentsLoading}
                  leading={<Download size={14} />}
                >
                  Export CSV
                </Button>
              }
            >
              {roster.isError ? (
                <EmptyState
                  compact
                  tone="danger"
                  title="Couldn't load the roster"
                  action={
                    <Button size="sm" onClick={() => roster.refetch()}>
                      Retry
                    </Button>
                  }
                />
              ) : (
                <Table
                  label={`${course.code} students`}
                  columns={studentColumns}
                  rows={studentRows}
                  loading={studentsLoading}
                  rowKey={(r) => r.student.id.toString()}
                  empty={
                    <EmptyState
                      compact
                      icon={<Users size={20} />}
                      title="Nobody enrolled"
                      body="An admin enrols students. They show up here with their attendance."
                    />
                  }
                />
              )}
            </Panel>
          ) : (
            <Panel
              flush
              title="Session history"
              actions={
                <Button size="sm" onClick={exportSessions} disabled={!sessionRows.length} leading={<Download size={14} />}>
                  Export CSV
                </Button>
              }
            >
              <Table
                label={`${course.code} sessions`}
                columns={sessionColumns}
                rows={sessionRows}
                loading={records.isLoading && sessions.length > 0}
                rowKey={(r) => r.session.id.toString()}
                onRowClick={(r) => navigate(`/teacher/sessions/${r.session.id}`)}
                empty={
                  <EmptyState
                    compact
                    title="No sessions yet"
                    body="Each session you open is listed here with its turnout and the ATC it paid out."
                  />
                }
              />
            </Panel>
          )}
        </Tabs>
      </Stack>

      <OpenSessionDialog course={course} meta={meta} open={opening} onClose={() => setOpening(false)} />
    </Page>
  );
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}
