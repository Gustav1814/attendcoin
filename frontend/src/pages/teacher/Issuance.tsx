import { Coins, Download, RotateCw } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { SessionView } from "@/lib/contracts";
import { formatAtc, formatDate, formatInteger, formatPercent } from "@/lib/format";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { Select } from "@/ui/Field";
import { Meter } from "@/ui/Meter";
import { Page, PageHeader, Stack } from "@/ui/Page";
import { Panel } from "@/ui/Panel";
import { Stat } from "@/ui/Stat";
import { Table, type Column } from "@/ui/Table";
import { csvAtc, downloadCsv, fileStamp } from "./csv";
import { useCourseRecords, useTeacherCourses, type AttendanceRecord, type TeacherCourse } from "./data";
import { CourseCell, RowLink } from "./parts";
import parts from "./parts.module.css";
import styles from "./Issuance.module.css";

interface Totals {
  base: bigint;
  bonus: bigint;
  count: number;
  manual: number;
}

interface CourseRow extends Totals {
  entry: TeacherCourse;
  share: number | null;
}

interface SessionRow extends Totals {
  entry: TeacherCourse;
  session: SessionView;
}

const ZERO: Totals = { base: 0n, bonus: 0n, count: 0, manual: 0 };

function add(t: Totals, r: AttendanceRecord): Totals {
  return {
    base: t.base + r.reward,
    bonus: t.bonus + r.bonus,
    count: t.count + 1,
    manual: t.manual + (r.manual ? 1 : 0),
  };
}

export function Issuance() {
  const courses = useTeacherCourses();
  const records = useCourseRecords(courses.data?.map((c) => c.course.id) ?? []);
  const navigate = useNavigate();
  const [filter, setFilter] = useState("all");

  const entries = courses.data ?? [];
  const list = records.data ?? [];
  const bySession = new Map<string, Totals>();
  const byCourse = new Map<string, Totals>();
  for (const r of list) {
    const s = r.sessionId.toString();
    const c = r.courseId.toString();
    bySession.set(s, add(bySession.get(s) ?? ZERO, r));
    byCourse.set(c, add(byCourse.get(c) ?? ZERO, r));
  }
  const total = list.reduce(add, ZERO);
  const grand = total.base + total.bonus;

  const courseRows: CourseRow[] = entries.map((entry) => {
    const t = byCourse.get(entry.course.id.toString()) ?? ZERO;
    return { entry, ...t, share: grand > 0n ? Number(((t.base + t.bonus) * 10_000n) / grand) / 10_000 : null };
  });

  const sessionRows: SessionRow[] = entries
    .filter((e) => filter === "all" || e.course.id.toString() === filter)
    .flatMap((entry) =>
      entry.sessions.map((session) => ({ entry, session, ...(bySession.get(session.id.toString()) ?? ZERO) })),
    )
    .sort((a, b) => b.session.openedAt - a.session.openedAt);

  const loading = courses.isLoading || records.isLoading;

  const courseColumns: Column<CourseRow>[] = [
    {
      key: "course",
      header: "Course",
      render: (r) => <CourseCell course={r.entry.course} meta={r.entry.meta} to={`/teacher/courses/${r.entry.course.id}`} />,
    },
    {
      key: "sessions",
      header: "Sessions",
      align: "right",
      hideOnMobile: true,
      render: (r) => formatInteger(r.entry.sessions.length),
    },
    { key: "count", header: "Attendances", align: "right", render: (r) => formatInteger(r.count) },
    {
      key: "bonus",
      header: "Streak bonus",
      align: "right",
      numeric: true,
      hideOnMobile: true,
      render: (r) => formatAtc(r.bonus),
    },
    {
      key: "total",
      header: "Total ATC",
      align: "right",
      numeric: true,
      render: (r) => <span className="t-mark">{formatAtc(r.base + r.bonus)}</span>,
    },
    {
      key: "share",
      header: "Share",
      width: "18%",
      hideOnMobile: true,
      render: (r) => (
        <div className={parts.rate}>
          <Meter value={r.share} tone="mark" label={`${r.entry.course.code} share of ATC issued`} />
          <span className="t-num">{formatPercent(r.share)}</span>
        </div>
      ),
    },
  ];

  const sessionColumns: Column<SessionRow>[] = [
    {
      key: "session",
      header: "Session",
      render: (r) => (
        <span className={styles.session}>
          <RowLink to={`/teacher/sessions/${r.session.id}`}>
            {r.entry.course.code} <span className="t-muted t-num">#{r.session.index}</span>
          </RowLink>
          <span className={styles.date}>{formatDate(r.session.openedAt)}</span>
        </span>
      ),
    },
    { key: "count", header: "Attendances", align: "right", render: (r) => formatInteger(r.count) },
    {
      key: "manual",
      header: "Manual",
      align: "right",
      hideOnMobile: true,
      render: (r) => (r.manual ? formatInteger(r.manual) : <span className="t-muted">0</span>),
    },
    {
      key: "base",
      header: "Base",
      align: "right",
      numeric: true,
      hideOnMobile: true,
      render: (r) => formatAtc(r.base),
    },
    {
      key: "bonus",
      header: "Bonus",
      align: "right",
      numeric: true,
      hideOnMobile: true,
      render: (r) => (r.bonus > 0n ? <span className="t-pen">{formatAtc(r.bonus)}</span> : formatAtc(r.bonus)),
    },
    {
      key: "total",
      header: "Total ATC",
      align: "right",
      numeric: true,
      render: (r) => <span className="t-mark">{formatAtc(r.base + r.bonus)}</span>,
    },
  ];

  const exportCsv = () =>
    downloadCsv(
      `atc-issuance-${fileStamp()}.csv`,
      ["Course", "Session ID", "Number", "Opened", "Attendances", "Manual", "Base ATC", "Bonus ATC", "Total ATC"],
      sessionRows.map((r) => [
        r.entry.course.code,
        r.session.id.toString(),
        r.session.index,
        new Date(r.session.openedAt * 1000).toISOString(),
        r.count,
        r.manual,
        csvAtc(r.base),
        csvAtc(r.bonus),
        csvAtc(r.base + r.bonus),
      ]),
    );

  if (courses.isError || records.isError) {
    return (
      <Page>
        <PageHeader eyebrow="Teacher" title="Token issuance" />
        <EmptyState
          tone="danger"
          title="Couldn't read the attendance log"
          body="The RPC didn't return the events. Public endpoints sometimes cap log queries; try again in a moment."
          action={
            <Button
              onClick={() => (courses.isError ? courses.refetch() : records.refetch())}
              leading={<RotateCw size={14} />}
            >
              Retry
            </Button>
          }
        />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        eyebrow="Teacher"
        title="Token issuance"
        description="ATC minted to your students, read from the AttendanceRecorded events of your courses."
        actions={
          <Button onClick={exportCsv} disabled={loading || sessionRows.length === 0} leading={<Download size={16} />}>
            Export CSV
          </Button>
        }
      />

      <Stack gap={8}>
        <div className={parts.stats}>
          <Stat label="Total issued" value={loading ? null : formatAtc(grand)} unit="ATC" tone="mark" loading={loading} />
          <Stat label="Per attendance" value={loading ? null : formatAtc(total.base)} unit="ATC" loading={loading} />
          <Stat label="Streak bonuses" value={loading ? null : formatAtc(total.bonus)} unit="ATC" tone="pen" loading={loading} />
          <Stat label="Attendances" value={loading ? null : total.count} loading={loading} />
        </div>

        {!loading && entries.length === 0 ? (
          <EmptyState
            icon={<Coins size={20} />}
            title="Nothing issued yet"
            body="Once you have a course and record attendance, minted ATC is broken down here."
          />
        ) : (
          <>
            <Panel title="By course" flush>
              <Table
                label="ATC issued by course"
                columns={courseColumns}
                rows={courseRows}
                loading={loading}
                rowKey={(r) => r.entry.course.id.toString()}
                onRowClick={(r) => navigate(`/teacher/courses/${r.entry.course.id}`)}
              />
            </Panel>

            <Panel
              title="By session"
              flush
              actions={
                <Select
                  aria-label="Filter sessions by course"
                  className={styles.filter}
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  options={[
                    { value: "all", label: "All courses" },
                    ...entries.map((e) => ({ value: e.course.id.toString(), label: e.course.code })),
                  ]}
                />
              }
            >
              <Table
                label="ATC issued by session"
                columns={sessionColumns}
                rows={sessionRows}
                loading={loading}
                rowKey={(r) => r.session.id.toString()}
                onRowClick={(r) => navigate(`/teacher/sessions/${r.session.id}`)}
                empty={<EmptyState compact title="No sessions" body="This course hasn't held a session yet." />}
              />
            </Panel>
          </>
        )}
      </Stack>
    </Page>
  );
}
