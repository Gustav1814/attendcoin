import { BookOpen, MonitorPlay, Play, RotateCw } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatAtc, formatDuration, formatInteger, formatPercent, formatTime } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { Meter } from "@/ui/Meter";
import { Page, PageHeader, Stack } from "@/ui/Page";
import { Panel } from "@/ui/Panel";
import { Stat } from "@/ui/Stat";
import { Table, type Column } from "@/ui/Table";
import { useCourseRecords, useLimits, useTeacherCourses, type TeacherCourse } from "./data";
import { OpenSessionDialog } from "./OpenSessionDialog";
import { CourseCell, PhaseBadge, RowAction, openBlocker, sessionPhase } from "./parts";
import parts from "./parts.module.css";
import styles from "./Courses.module.css";

export function Courses() {
  const courses = useTeacherCourses();
  const limits = useLimits();
  const records = useCourseRecords(courses.data?.map((c) => c.course.id) ?? []);
  const now = Math.floor(useNow(1000) / 1000);
  const navigate = useNavigate();
  const [opening, setOpening] = useState<TeacherCourse | null>(null);

  const rows = courses.data ?? [];
  const live = rows.filter((r) => r.live);
  const held = rows.reduce((n, r) => n + r.sessions.length, 0);
  const seats = rows.reduce((n, r) => n + r.sessions.filter((s) => s !== r.live).length * r.course.enrolledCount, 0);
  const filled = rows.reduce(
    (n, r) => n + r.sessions.filter((s) => s !== r.live).reduce((m, s) => m + s.attendeeCount, 0),
    0,
  );
  const issued = records.data?.reduce((n, r) => n + r.reward + r.bonus, 0n);

  const columns: Column<TeacherCourse>[] = [
    {
      key: "course",
      header: "Course",
      render: (r) => <CourseCell course={r.course} meta={r.meta} to={`/teacher/courses/${r.course.id}`} />,
    },
    {
      key: "enrolled",
      header: "Enrolled",
      align: "right",
      numeric: true,
      render: (r) => formatInteger(r.course.enrolledCount),
    },
    {
      key: "sessions",
      header: "Sessions",
      align: "right",
      numeric: true,
      hideOnMobile: true,
      render: (r) => formatInteger(r.sessions.length),
    },
    {
      key: "attendance",
      header: "Avg attendance",
      width: "22%",
      hideOnMobile: true,
      render: (r) => (
        <div className={parts.rate}>
          <Meter value={r.attendance} label={`${r.course.code} average attendance`} />
          <span className="t-num">{formatPercent(r.attendance)}</span>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) =>
        r.latest && !r.latest.finalized ? (
          <PhaseBadge phase={sessionPhase(r.latest, r.live != null, now)} />
        ) : r.course.active ? (
          <span className="t-muted">Idle</span>
        ) : (
          <span className="t-muted">Inactive</span>
        ),
    },
    {
      key: "action",
      header: <span className="visually-hidden">Action</span>,
      align: "right",
      render: (r) => (
        <RowAction>
          <CourseAction entry={r} blocker={openBlocker(r, limits, now)} onOpen={() => setOpening(r)} />
        </RowAction>
      ),
    },
  ];

  return (
    <Page>
      <PageHeader eyebrow="Teacher" title="Your courses" />

      <Stack gap={8}>
        {live.length > 0 && (
          <ul className={styles.live} aria-label="Sessions in progress">
            {live.map((r) => {
              const s = r.live!;
              const scanning = now <= s.closesAt;
              return (
                <li key={s.id.toString()} className={styles.liveRow}>
                  <span className={styles.liveDot} aria-hidden="true" />
                  <span className={styles.liveText}>
                    <strong>{r.course.code}</strong> session #{s.index}{" "}
                    {scanning ? (
                      <>
                        closes in <span className="t-num">{formatDuration(s.closesAt - now)}</span>
                      </>
                    ) : (
                      <>
                        is closed to scans. Submit by{" "}
                        <span className="t-num">{formatTime(s.closesAt + limits.grace)}</span>
                      </>
                    )}
                  </span>
                  <Button size="sm" variant="primary" to={`/teacher/sessions/${s.id}`} leading={<MonitorPlay size={14} />}>
                    {scanning ? "Open screen" : "Submit"}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}

        <div className={parts.stats}>
          <Stat label="Courses" value={courses.data ? rows.length : null} loading={courses.isLoading} />
          <Stat label="Sessions held" value={courses.data ? held : null} loading={courses.isLoading} />
          <Stat
            label="Avg attendance"
            value={courses.data ? formatPercent(seats ? filled / seats : null) : null}
            tone="ink"
            loading={courses.isLoading}
          />
          <Stat
            label="ATC issued"
            value={issued == null ? (rows.length ? null : "0") : formatAtc(issued)}
            tone="mark"
            loading={courses.isLoading || records.isLoading}
          />
        </div>

        <Panel title="Courses" flush>
          {courses.isError ? (
            <EmptyState
              tone="danger"
              title="Couldn't load your courses"
              body="The chain didn't answer. Check the RPC connection and try again."
              action={
                <Button onClick={() => courses.refetch()} leading={<RotateCw size={14} />}>
                  Retry
                </Button>
              }
            />
          ) : (
            <Table
              label="Your courses"
              columns={columns}
              rows={courses.data}
              loading={courses.isLoading}
              rowKey={(r) => r.course.id.toString()}
              onRowClick={(r) => navigate(`/teacher/courses/${r.course.id}`)}
              empty={
                <EmptyState
                  icon={<BookOpen size={20} />}
                  title="No courses yet"
                  body="An admin assigns courses to your wallet. They appear here as soon as that happens."
                />
              }
            />
          )}
        </Panel>
      </Stack>

      {opening && (
        <OpenSessionDialog
          course={opening.course}
          meta={opening.meta}
          open={opening != null}
          onClose={() => setOpening(null)}
        />
      )}
    </Page>
  );
}

function CourseAction({ entry, blocker, onOpen }: { entry: TeacherCourse; blocker: string | null; onOpen: () => void }) {
  if (entry.live) {
    return (
      <Button size="sm" to={`/teacher/sessions/${entry.live.id}`} leading={<MonitorPlay size={14} />}>
        Open screen
      </Button>
    );
  }
  if (blocker) {
    return <span className={styles.blocked}>{blocker}</span>;
  }
  return (
    <Button size="sm" variant="primary" leading={<Play size={14} />} onClick={onOpen}>
      Open session
    </Button>
  );
}
