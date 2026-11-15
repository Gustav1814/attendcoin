import { useQuery } from "@tanstack/react-query";
import type { EventLog, Provider } from "ethers";
import { api, type CourseMeta, type QueuedCheckIn } from "@/lib/api";
import {
  chain,
  logsFromBlock,
  range,
  readCourse,
  readSession,
  readStats,
  type AttendanceManagerContract,
  type CourseView,
  type SessionView,
} from "@/lib/contracts";
import { useChainKey, useContracts, useWallet } from "@/lib/wallet";

/** Mirrors the contract constants; read from chain when available. */
const DEFAULT_LIMITS: Limits = { gap: 4 * 3600, grace: 30 * 60, maxBatch: 100, paused: false };

export interface Limits {
  /** Seconds between openings of two sessions of one course. */
  gap: number;
  /** Seconds after closesAt during which check-ins may still be submitted. */
  grace: number;
  maxBatch: number;
  paused: boolean;
}

export function useLimits(): Limits {
  const { read } = useContracts();
  const query = useQuery({
    queryKey: ["chain", chain.chainId, "teacher-limits"],
    enabled: Boolean(read),
    staleTime: 30_000,
    queryFn: async (): Promise<Limits> => {
      const { manager } = read!;
      const [gap, grace, maxBatch, paused] = await Promise.all([
        // Added after the generated types were last refreshed.
        manager
          .getFunction("MIN_SESSION_GAP")()
          .then((v: bigint) => Number(v))
          .catch(() => DEFAULT_LIMITS.gap),
        manager.SUBMISSION_GRACE().then(Number),
        manager.MAX_BATCH().then(Number),
        manager.paused(),
      ]);
      return { gap, grace, maxBatch, paused };
    },
  });
  return query.data ?? DEFAULT_LIMITS;
}

export interface TeacherCourse {
  course: CourseView;
  meta: CourseMeta | null;
  /** Oldest first; `index` matches the position. */
  sessions: SessionView[];
  latest: SessionView | null;
  /** The newest session when it still accepts attendance. */
  live: SessionView | null;
  /** Share of seats filled across finished sessions; null before the first one ends. */
  attendance: number | null;
}

async function readTeacherCourse(manager: AttendanceManagerContract, course: CourseView): Promise<TeacherCourse> {
  const [meta, sessions] = await Promise.all([
    // Titles are a nicety; everything else works without the backend.
    api.courseMeta(course.id).catch(() => null),
    Promise.all(
      range(course.sessionCount).map(async (index) =>
        readSession(manager, await manager.sessionOfCourse(course.id, index)),
      ),
    ),
  ]);
  const latest = sessions.at(-1) ?? null;
  const accepting = latest ? await manager.isAcceptingAttendance(latest.id) : false;
  const live = accepting ? latest : null;
  const done = sessions.filter((s) => s !== live);
  const seats = done.length * course.enrolledCount;
  const attended = done.reduce((n, s) => n + s.attendeeCount, 0);
  return { course, meta, sessions, latest, live, attendance: seats ? Math.min(1, attended / seats) : null };
}

export function useTeacherCourses() {
  const { read } = useContracts();
  const { address } = useWallet();
  const key = useChainKey();
  return useQuery({
    queryKey: [...key, "teacher-courses"],
    enabled: Boolean(read && address),
    refetchInterval: 15_000,
    queryFn: async (): Promise<TeacherCourse[]> => {
      const { manager } = read!;
      const count = await manager.courseCount();
      const courses = await Promise.all(range(count).map((id) => readCourse(manager, id)));
      const mine = courses.filter((c) => c.teacher.toLowerCase() === address!.toLowerCase());
      return Promise.all(mine.map((c) => readTeacherCourse(manager, c)));
    },
  });
}

export type CourseLookup = { status: "ok"; data: TeacherCourse } | { status: "missing" } | { status: "not-yours" };

export function useTeacherCourse(courseId: bigint | null) {
  const { read } = useContracts();
  const { address } = useWallet();
  const key = useChainKey();
  return useQuery({
    queryKey: [...key, "teacher-course", courseId?.toString()],
    enabled: Boolean(read && address && courseId),
    refetchInterval: 15_000,
    queryFn: async (): Promise<CourseLookup> => {
      const { manager } = read!;
      const count = await manager.courseCount();
      if (!courseId || courseId > count) return { status: "missing" };
      const course = await readCourse(manager, courseId);
      if (course.teacher.toLowerCase() !== address!.toLowerCase()) return { status: "not-yours" };
      return { status: "ok", data: await readTeacherCourse(manager, course) };
    },
  });
}

export interface SessionDetail {
  session: SessionView;
  course: CourseView;
  meta: CourseMeta | null;
  accepting: boolean;
}

export type SessionLookup = { status: "ok"; data: SessionDetail } | { status: "missing" } | { status: "not-yours" };

export function useTeacherSession(sessionId: bigint | null) {
  const { read } = useContracts();
  const { address } = useWallet();
  const key = useChainKey();
  return useQuery({
    queryKey: [...key, "teacher-session", sessionId?.toString()],
    enabled: Boolean(read && address && sessionId),
    refetchInterval: 5_000,
    queryFn: async (): Promise<SessionLookup> => {
      const { manager } = read!;
      const count = await manager.sessionCount();
      if (!sessionId || sessionId > count) return { status: "missing" };
      const session = await readSession(manager, sessionId);
      const [course, accepting, meta] = await Promise.all([
        readCourse(manager, session.courseId),
        manager.isAcceptingAttendance(sessionId),
        api.courseMeta(session.courseId).catch(() => null),
      ]);
      if (course.teacher.toLowerCase() !== address!.toLowerCase()) return { status: "not-yours" };
      return { status: "ok", data: { session, course, meta, accepting } };
    },
  });
}

export interface RosterStudent {
  id: bigint;
  wallet: string;
  active: boolean;
  name: string | null;
}

/**
 * Enrolment is only queryable per student, so this walks every registered
 * student. JsonRpcProvider batches the calls, which keeps a class-sized
 * registry to a handful of requests.
 */
export function useRoster(courseId: bigint | null) {
  const { read } = useContracts();
  const key = useChainKey();
  return useQuery({
    queryKey: [...key, "roster", courseId?.toString()],
    enabled: Boolean(read && courseId),
    staleTime: 60_000,
    queryFn: async (): Promise<RosterStudent[]> => {
      const { manager } = read!;
      const ids = range(await manager.studentCount());
      const flags = await Promise.all(ids.map((id) => manager.isEnrolled(courseId!, id)));
      const enrolled = ids.filter((_, i) => flags[i]);
      const students = await Promise.all(enrolled.map((id) => manager.getStudent(id)));
      const names = await fetchNames(students.map((s) => s.wallet));
      return enrolled
        .map((id, i) => ({
          id,
          wallet: students[i].wallet,
          active: students[i].active,
          name: names.get(students[i].wallet.toLowerCase()) ?? null,
        }))
        .sort((a, b) => displayName(a).localeCompare(displayName(b)));
    },
  });
}

/** Wallet to name. Missing profiles and an unreachable backend both yield an empty map. */
export async function fetchNames(wallets: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(wallets.map((w) => w.toLowerCase()))];
  const names = new Map<string, string>();
  for (let i = 0; i < unique.length; i += 100) {
    const profiles = await api.profiles(unique.slice(i, i + 100)).catch(() => []);
    for (const p of profiles) names.set(p.wallet.toLowerCase(), p.name);
  }
  return names;
}

export function displayName(s: { name: string | null; wallet: string }): string {
  return s.name ?? s.wallet;
}

export interface AttendanceRecord {
  key: string;
  sessionId: bigint;
  courseId: bigint;
  studentId: bigint;
  wallet: string;
  reward: bigint;
  bonus: bigint;
  streak: number;
  manual: boolean;
  blockNumber: number;
  txHash: string;
}

async function queryRecords(
  manager: AttendanceManagerContract,
  provider: Provider,
  sessionId: bigint | null,
  courseId: bigint | null,
): Promise<AttendanceRecord[]> {
  const from = await logsFromBlock(provider);
  const filter = manager.filters.AttendanceRecorded(sessionId, courseId, null);
  const logs = (await manager.queryFilter(filter, from)) as EventLog[];
  return logs
    .filter((l): l is EventLog => "args" in l)
    .map((l) => ({
      key: `${l.transactionHash}-${l.index}`,
      sessionId: l.args.sessionId as bigint,
      courseId: l.args.courseId as bigint,
      studentId: l.args.studentId as bigint,
      wallet: l.args.wallet as string,
      reward: l.args.reward as bigint,
      bonus: l.args.bonus as bigint,
      streak: Number(l.args.streak),
      manual: Boolean(l.args.manual),
      blockNumber: l.blockNumber,
      txHash: l.transactionHash,
    }));
}

export function useCourseRecords(courseIds: bigint[]) {
  const { read } = useContracts();
  const { provider } = useWallet();
  const key = useChainKey();
  const ids = courseIds.map(String).sort();
  return useQuery({
    queryKey: [...key, "records", "courses", ids.join(",")],
    enabled: Boolean(read && provider && ids.length),
    queryFn: async () => {
      const lists = await Promise.all(ids.map((id) => queryRecords(read!.manager, provider!, null, BigInt(id))));
      return lists.flat();
    },
  });
}

export function useSessionRecords(sessionId: bigint, live: boolean) {
  const { read } = useContracts();
  const { provider } = useWallet();
  const key = useChainKey();
  return useQuery({
    queryKey: [...key, "records", "session", sessionId.toString()],
    enabled: Boolean(read && provider),
    refetchInterval: live ? 4_000 : false,
    queryFn: () => queryRecords(read!.manager, provider!, sessionId, null),
  });
}

export function useBlockTimes(blockNumbers: number[]) {
  const { provider } = useWallet();
  const key = useChainKey();
  const unique = [...new Set(blockNumbers)].sort((a, b) => a - b);
  return useQuery({
    queryKey: [...key, "block-times", unique.join(",")],
    enabled: Boolean(provider && unique.length),
    staleTime: Infinity,
    queryFn: async () => {
      const entries = await Promise.all(
        unique.map(async (n) => [n, (await provider!.getBlock(n).catch(() => null))?.timestamp ?? null] as const),
      );
      return new Map(entries);
    },
  });
}

export function useSessionQueue(sessionId: bigint, poll: boolean) {
  const key = useChainKey();
  return useQuery({
    queryKey: [...key, "queue", sessionId.toString()],
    refetchInterval: poll ? 2_500 : false,
    retry: 1,
    queryFn: (): Promise<QueuedCheckIn[]> => api.sessionQueue(sessionId),
  });
}

export interface BatchOutcome {
  recorded: { studentId: bigint; wallet: string; paid: bigint }[];
  rejected: { student: string; reason: number }[];
}

/** Reads accepted and refused entries from a submitCheckIns or markManual receipt. */
export async function readOutcome(
  manager: AttendanceManagerContract,
  provider: Provider,
  hash: string,
): Promise<BatchOutcome> {
  const receipt = await provider.getTransactionReceipt(hash);
  const target = (await manager.getAddress()).toLowerCase();
  const outcome: BatchOutcome = { recorded: [], rejected: [] };
  for (const log of receipt?.logs ?? []) {
    if (log.address.toLowerCase() !== target) continue;
    const parsed = manager.interface.parseLog(log);
    if (parsed?.name === "AttendanceRecorded") {
      outcome.recorded.push({
        studentId: parsed.args.studentId as bigint,
        wallet: parsed.args.wallet as string,
        paid: (parsed.args.reward as bigint) + (parsed.args.bonus as bigint),
      });
    } else if (parsed?.name === "CheckInRejected") {
      outcome.rejected.push({ student: parsed.args.student as string, reason: Number(parsed.args.reason) });
    }
  }
  return outcome;
}

export function courseTitle(course: Pick<CourseView, "code">, meta?: CourseMeta | null): string {
  return meta?.title ? `${course.code} · ${meta.title}` : course.code;
}

/**
 * The contract resets a streak only when the next attendance is recorded, so a
 * stored streak can be stale. It is alive if the student attended the newest
 * session, or the one before while the newest is still open.
 */
export function liveStreak(
  stats: { streak: number; lastAttendedIndex: number },
  sessionCount: number,
  latestOpen: boolean,
): number {
  if (stats.streak === 0) return 0;
  if (stats.lastAttendedIndex === sessionCount) return stats.streak;
  if (stats.lastAttendedIndex === sessionCount - 1 && latestOpen) return stats.streak;
  return 0;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function useCourseStats(courseId: bigint | null, studentIds: bigint[]) {
  const { read } = useContracts();
  const key = useChainKey();
  const ids = studentIds.map(String);
  return useQuery({
    queryKey: [...key, "course-stats", courseId?.toString(), ids.join(",")],
    enabled: Boolean(read && courseId && ids.length),
    queryFn: async () => {
      const stats = await Promise.all(studentIds.map((id) => readStats(read!.manager, courseId!, id)));
      return new Map(ids.map((id, i) => [id, stats[i]]));
    },
  });
}

/** Route params are user-editable; anything but a positive integer is treated as missing. */
export function parseId(value: string | undefined): bigint | null {
  if (!value || !/^\d{1,30}$/.test(value)) return null;
  const id = BigInt(value);
  return id > 0n ? id : null;
}
