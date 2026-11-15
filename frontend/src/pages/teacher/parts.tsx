import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { CourseMeta } from "@/lib/api";
import type { CourseView, SessionView } from "@/lib/contracts";
import { formatTime } from "@/lib/format";
import { Badge } from "@/ui/Badge";
import { cx } from "@/ui/cx";
import type { Limits, TeacherCourse } from "./data";
import styles from "./parts.module.css";

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className={styles.back}>
      <ArrowLeft size={14} aria-hidden="true" />
      {children}
    </Link>
  );
}

/** Pass `to` when the row is clickable; the link keeps it reachable by keyboard. */
export function CourseCell({
  course,
  meta,
  to,
}: {
  course: Pick<CourseView, "code">;
  meta: CourseMeta | null;
  to?: string;
}) {
  return (
    <span className={styles.course}>
      {to ? (
        <RowLink to={to} className={styles.code}>
          {course.code}
        </RowLink>
      ) : (
        <span className={styles.code}>{course.code}</span>
      )}
      {meta?.title && <span className={styles.title}>{meta.title}</span>}
    </span>
  );
}

/** The keyboard path into a clickable table row, which itself only handles pointer clicks. */
export function RowLink({ to, className, children }: { to: string; className?: string; children: ReactNode }) {
  return (
    <Link to={to} className={cx(styles.rowLink, className)} onClick={(e) => e.stopPropagation()}>
      {children}
    </Link>
  );
}

/** Keeps clicks on buttons inside a clickable table row from also opening the row. */
export function RowAction({ children }: { children: ReactNode }) {
  return (
    <span className={styles.rowAction} onClick={(e) => e.stopPropagation()}>
      {children}
    </span>
  );
}

export type SessionPhase = "live" | "grace" | "closed" | "finalized";

/** "grace" is after the scan window but before submissions stop. */
export function sessionPhase(session: SessionView, accepting: boolean, now: number): SessionPhase {
  if (session.finalized) return "finalized";
  if (!accepting) return "closed";
  return now <= session.closesAt ? "live" : "grace";
}

export function PhaseBadge({ phase }: { phase: SessionPhase }) {
  switch (phase) {
    case "live":
      return (
        <Badge tone="pen" dot>
          Live
        </Badge>
      );
    case "grace":
      return (
        <Badge tone="mark" dot>
          Submitting
        </Badge>
      );
    case "finalized":
      return <Badge tone="ink">Finalized</Badge>;
    default:
      return <Badge>Closed</Badge>;
  }
}

/** Why a new session can't be opened right now, or null when it can. */
export function openBlocker(entry: TeacherCourse, limits: Limits, now: number): string | null {
  if (!entry.course.active) return "Course inactive";
  if (limits.paused) return "Contract paused";
  if (entry.live) return "Session in progress";
  if (entry.latest) {
    const notBefore = entry.latest.openedAt + limits.gap;
    if (now < notBefore) return `Available at ${formatTime(notBefore)}`;
  }
  return null;
}
