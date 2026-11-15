import { useQuery } from "@tanstack/react-query";
import type { EventLog } from "ethers";
import { api, type CourseMeta } from "@/lib/api";
import {
  chain,
  logsFromBlock,
  readCourse,
  readSession,
  readStats,
  type CourseView,
  type SessionView,
  type StatsView,
} from "@/lib/contracts";
import { useRoles } from "@/lib/roles";
import { useChainKey, useContracts, useWallet } from "@/lib/wallet";

export interface RewardRules {
  reward: bigint;
  bonus: bigint;
  /** Sessions in a row that earn the bonus. */
  length: number;
}

export function useRewardRules() {
  const { read } = useContracts();
  return useQuery({
    queryKey: ["chain", chain.chainId, "rules"],
    enabled: Boolean(read),
    staleTime: 60_000,
    queryFn: async (): Promise<RewardRules> => {
      const [reward, bonus, length] = await Promise.all([
        read!.manager.rewardPerAttendance(),
        read!.manager.streakBonus(),
        read!.manager.streakLength(),
      ]);
      return { reward, bonus, length: Number(length) };
    },
  });
}

export function useAtcBalance() {
  const { read } = useContracts();
  const { address } = useWallet();
  const key = useChainKey();
  return useQuery({
    queryKey: [...key, "balance"],
    enabled: Boolean(read && address),
    queryFn: () => read!.token.balanceOf(address!),
  });
}

export interface StudentCourse {
  course: CourseView;
  meta: CourseMeta | null;
  stats: StatsView;
  /** The newest session, if the course has had one. */
  latest: (SessionView & { accepting: boolean; attended: boolean }) | null;
  /** Streak that still counts toward the next bonus; 0 once a session was missed. */
  currentStreak: number;
}

export function useStudentCourses() {
  const { read } = useContracts();
  const { studentId } = useRoles();
  const key = useChainKey();
  return useQuery({
    queryKey: [...key, "student-courses", studentId.toString()],
    enabled: Boolean(read && studentId > 0n),
    refetchInterval: 15_000,
    queryFn: async (): Promise<StudentCourse[]> => {
      const { manager } = read!;
      const ids = await manager.getCoursesOfStudent(studentId);
      return Promise.all(
        ids.map(async (courseId) => {
          const [course, stats, meta] = await Promise.all([
            readCourse(manager, courseId),
            readStats(manager, courseId, studentId),
            // Titles are a nicety; the page works without the backend.
            api.courseMeta(courseId).catch(() => null),
          ]);
          let latest: StudentCourse["latest"] = null;
          if (course.sessionCount > 0) {
            const sessionId = await manager.sessionOfCourse(courseId, course.sessionCount);
            const [session, accepting, attended] = await Promise.all([
              readSession(manager, sessionId),
              manager.isAcceptingAttendance(sessionId),
              manager.attended(sessionId, studentId),
            ]);
            latest = { ...session, accepting, attended };
          }
          return { course, meta, stats, latest, currentStreak: currentStreak(stats, course, latest) };
        }),
      );
    },
  });
}

/**
 * The contract only resets a streak when the next attendance is recorded, so
 * a stored streak can be stale. It is still alive if the student attended the
 * newest session, or the one before it while the newest is still open.
 */
function currentStreak(stats: StatsView, course: CourseView, latest: StudentCourse["latest"]): number {
  if (stats.streak === 0) return 0;
  if (stats.lastAttendedIndex === course.sessionCount) return stats.streak;
  if (stats.lastAttendedIndex === course.sessionCount - 1 && latest?.accepting) return stats.streak;
  return 0;
}

export interface AttendanceEntry {
  key: string;
  sessionId: bigint;
  courseId: bigint;
  reward: bigint;
  bonus: bigint;
  streak: number;
  manual: boolean;
  txHash: string;
  blockNumber: number;
  timestamp: number | null;
}

export function useAttendanceHistory(limit = 10) {
  const { read, deployed } = useContracts();
  const { provider } = useWallet();
  const { studentId } = useRoles();
  const key = useChainKey();
  return useQuery({
    queryKey: [...key, "attendance-history", studentId.toString(), limit],
    enabled: Boolean(deployed && read && provider && studentId > 0n),
    queryFn: async (): Promise<AttendanceEntry[]> => {
      const { manager } = read!;
      const from = await logsFromBlock(provider!);
      const filter = manager.filters.AttendanceRecorded(null, null, studentId);
      const logs = (await manager.queryFilter(filter, from)) as EventLog[];
      const recent = logs
        .filter((l): l is EventLog => "args" in l)
        .sort((a, b) => b.blockNumber - a.blockNumber || b.index - a.index)
        .slice(0, limit);
      const blocks = new Map<number, number | null>();
      await Promise.all(
        [...new Set(recent.map((l) => l.blockNumber))].map(async (n) => {
          const block = await provider!.getBlock(n).catch(() => null);
          blocks.set(n, block?.timestamp ?? null);
        }),
      );
      return recent.map((l) => ({
        key: `${l.transactionHash}-${l.index}`,
        sessionId: l.args.sessionId as bigint,
        courseId: l.args.courseId as bigint,
        reward: l.args.reward as bigint,
        bonus: l.args.bonus as bigint,
        streak: Number(l.args.streak),
        manual: Boolean(l.args.manual),
        txHash: l.transactionHash,
        blockNumber: l.blockNumber,
        timestamp: blocks.get(l.blockNumber) ?? null,
      }));
    },
  });
}

export function useSessionIndex(sessionIds: bigint[]) {
  const { read } = useContracts();
  const key = useChainKey();
  return useQuery({
    queryKey: [...key, "sessions", sessionIds.map(String).join(",")],
    enabled: Boolean(read && sessionIds.length),
    staleTime: Infinity,
    queryFn: async () => {
      const unique = [...new Set(sessionIds.map(String))].map(BigInt);
      const sessions = await Promise.all(unique.map((id) => readSession(read!.manager, id)));
      return new Map(sessions.map((s) => [s.id.toString(), s]));
    },
  });
}

export function courseLabel(course: Pick<CourseView, "code">, meta?: CourseMeta | null): string {
  return meta?.title ? `${course.code} · ${meta.title}` : course.code;
}
