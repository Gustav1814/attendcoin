import { useQuery } from "@tanstack/react-query";
import { getAddress, isAddress, id as keccakId, type BaseContract, type EventLog, type Log, type Provider } from "ethers";
import { api, type CourseMeta } from "@/lib/api";
import { logsFromBlock, range, readAllCourses, readAllItems, type CourseView, type ItemView } from "@/lib/contracts";
import { useChainKey, useContracts, useWallet } from "@/lib/wallet";

export const PAUSER_ROLE = keccakId("PAUSER_ROLE");
export const REGISTRAR_ROLE = keccakId("REGISTRAR_ROLE");
/** RewardStore treats the uint32 maximum as unlimited stock. */
export const UNLIMITED_STOCK = 4_294_967_295;
/** AttendanceManager.MAX_BATCH. */
export const MAX_BATCH = 100;

export function useAdminKey() {
  return [...useChainKey(), "admin"] as const;
}

export function isEventLog(log: EventLog | Log): log is EventLog {
  return "args" in log;
}

export function byNewest(a: Log, b: Log): number {
  return b.blockNumber - a.blockNumber || b.index - a.index;
}

export async function blockTimes(provider: Provider, blocks: number[]): Promise<Map<number, number | null>> {
  const unique = [...new Set(blocks)];
  const times = await Promise.all(unique.map((n) => provider.getBlock(n).then((b) => b?.timestamp ?? null, () => null)));
  return new Map(unique.map((n, i) => [n, times[i]]));
}

/**
 * Public names for a set of wallets. The backend caps a batch at 100 wallets.
 * A missing backend leaves names empty instead of failing the page.
 */
export async function lookupNames(wallets: string[]): Promise<{ names: Map<string, string>; offline: boolean }> {
  const unique = [...new Set(wallets.map((w) => w.toLowerCase()))];
  const names = new Map<string, string>();
  try {
    for (let i = 0; i < unique.length; i += 100) {
      const profiles = await api.profiles(unique.slice(i, i + 100));
      for (const p of profiles) names.set(p.wallet.toLowerCase(), p.name);
    }
    return { names, offline: false };
  } catch {
    return { names, offline: true };
  }
}

export interface Protocol {
  supply: bigint;
  cap: bigint;
  escrow: bigint;
  totalRewarded: bigint;
  totalBurned: bigint;
  totalToTreasury: bigint;
  transferRestricted: boolean;
  burnOnSettle: boolean;
  treasury: string;
  treasuryAllowed: boolean;
  paused: { token: boolean; manager: boolean; store: boolean };
  counts: { students: number; courses: number; sessions: number; items: number; redemptions: number };
  rules: { reward: bigint; bonus: bigint; length: number };
  bounds: { maxReward: bigint; maxBonus: bigint; minLength: number; maxLength: number };
  can: { pauseToken: boolean; manageStore: boolean; allowlist: boolean };
}

export function useProtocol() {
  const { read } = useContracts();
  const { address } = useWallet();
  const key = useAdminKey();
  return useQuery({
    queryKey: [...key, "protocol"],
    enabled: Boolean(read && address),
    refetchInterval: 20_000,
    queryFn: async (): Promise<Protocol> => {
      const { token, manager, store } = read!;
      const storeAddress = await store.getAddress();
      const [
        supply,
        cap,
        escrow,
        transferRestricted,
        tokenPaused,
        pauseToken,
        allowlist,
        managerPaused,
        totalRewarded,
        students,
        courses,
        sessions,
        reward,
        bonus,
        length,
        maxReward,
        maxBonus,
        minLength,
        maxLength,
        storePaused,
        totalBurned,
        totalToTreasury,
        burnOnSettle,
        treasury,
        items,
        redemptions,
        manageStore,
      ] = await Promise.all([
        token.totalSupply(),
        token.cap(),
        token.balanceOf(storeAddress),
        token.transferRestricted(),
        token.paused(),
        token.hasRole(PAUSER_ROLE, address!),
        token.hasRole(REGISTRAR_ROLE, address!),
        manager.paused(),
        manager.totalRewarded(),
        manager.studentCount(),
        manager.courseCount(),
        manager.sessionCount(),
        manager.rewardPerAttendance(),
        manager.streakBonus(),
        manager.streakLength(),
        manager.MAX_REWARD(),
        manager.MAX_BONUS(),
        manager.MIN_STREAK_LENGTH(),
        manager.MAX_STREAK_LENGTH(),
        store.paused(),
        store.totalBurned(),
        store.totalToTreasury(),
        store.burnOnSettle(),
        store.treasury(),
        store.itemCount(),
        store.redemptionCount(),
        store.hasRole(keccakId("STORE_MANAGER_ROLE"), address!),
      ]);
      const treasuryAllowed = await token.isAllowed(treasury);
      return {
        supply,
        cap,
        escrow,
        totalRewarded,
        totalBurned,
        totalToTreasury,
        transferRestricted,
        burnOnSettle,
        treasury,
        treasuryAllowed,
        paused: { token: tokenPaused, manager: managerPaused, store: storePaused },
        counts: {
          students: Number(students),
          courses: Number(courses),
          sessions: Number(sessions),
          items: Number(items),
          redemptions: Number(redemptions),
        },
        rules: { reward, bonus, length: Number(length) },
        bounds: { maxReward, maxBonus, minLength: Number(minLength), maxLength: Number(maxLength) },
        can: { pauseToken, manageStore, allowlist },
      };
    },
  });
}

export interface StudentRow {
  id: bigint;
  wallet: string;
  active: boolean;
  registeredAt: number;
  name: string | null;
  courses: bigint[];
  balance: bigint;
}

export function useStudents() {
  const { read } = useContracts();
  const { provider } = useWallet();
  const key = useAdminKey();
  return useQuery({
    queryKey: [...key, "students"],
    enabled: Boolean(read && provider),
    queryFn: async () => {
      const { manager, token } = read!;
      const count = await manager.studentCount();
      const rows = await Promise.all(
        range(count).map(async (id) => {
          const [s, courses] = await Promise.all([manager.getStudent(id), manager.getCoursesOfStudent(id)]);
          const balance = await token.balanceOf(s.wallet);
          return {
            id,
            wallet: s.wallet,
            active: s.active,
            registeredAt: Number(s.registeredAt),
            courses: [...courses],
            balance,
          };
        }),
      );

      // Profiles are stored under the wallet a student registered with, so a
      // re-linked student is still found by one of their earlier wallets.
      const from = await logsFromBlock(provider!);
      const relinkLogs: Array<EventLog | Log> = await manager
        .queryFilter(manager.filters.StudentRelinked(), from)
        .catch(() => []);
      const relinks = relinkLogs.filter(isEventLog);
      const previous = new Map<string, string[]>();
      for (const l of relinks) {
        const sid = String(l.args.studentId);
        previous.set(sid, [...(previous.get(sid) ?? []), l.args.oldWallet as string]);
      }
      const { names, offline } = await lookupNames([
        ...rows.map((r) => r.wallet),
        ...[...previous.values()].flat(),
      ]);

      const students: StudentRow[] = rows.map((r) => {
        const candidates = [r.wallet, ...(previous.get(r.id.toString()) ?? []).reverse()];
        const name = candidates.map((w) => names.get(w.toLowerCase())).find(Boolean) ?? null;
        return { ...r, name };
      });
      return { students, namesOffline: offline };
    },
  });
}

export interface RoleHolder {
  account: string;
  name: string | null;
  since: number;
}

/**
 * AccessControl doesn't enumerate members, so holders are rebuilt from
 * RoleGranted/RoleRevoked and then confirmed with hasRole.
 */
async function roleHolders(
  contract: BaseContract & { hasRole(role: string, account: string): Promise<boolean> },
  role: string,
  provider: Provider,
): Promise<RoleHolder[]> {
  const from = await logsFromBlock(provider);
  const [granted, revoked] = await Promise.all([
    contract.queryFilter(contract.filters.RoleGranted(role), from),
    contract.queryFilter(contract.filters.RoleRevoked(role), from),
  ]);
  const latest = new Map<string, { granted: boolean; block: number; log: Log }>();
  const ordered = [
    ...granted.map((log) => ({ log, granted: true })),
    ...revoked.map((log) => ({ log, granted: false })),
  ].sort((a, b) => byNewest(b.log, a.log));
  for (const { log, granted: g } of ordered) {
    if (!isEventLog(log)) continue;
    const account = getAddress(log.args.account as string);
    const prev = latest.get(account);
    latest.set(account, { granted: g, block: g && prev?.granted ? prev.block : log.blockNumber, log });
  }
  const candidates = [...latest.entries()].filter(([, v]) => v.granted);
  const confirmed = await Promise.all(candidates.map(([account]) => contract.hasRole(role, account)));
  const holders = candidates.filter((_, i) => confirmed[i]);
  const times = await blockTimes(
    provider,
    holders.map(([, v]) => v.block),
  );
  const { names } = await lookupNames(holders.map(([a]) => a));
  return holders.map(([account, v]) => ({
    account,
    name: names.get(account.toLowerCase()) ?? null,
    since: times.get(v.block) ?? 0,
  }));
}

export function useRoleHolders(kind: "teacher" | "vendor") {
  const { read } = useContracts();
  const { provider } = useWallet();
  const key = useAdminKey();
  return useQuery({
    queryKey: [...key, "role-holders", kind],
    enabled: Boolean(read && provider),
    queryFn: () =>
      kind === "teacher"
        ? roleHolders(read!.manager, keccakId("TEACHER_ROLE"), provider!)
        : roleHolders(read!.store, keccakId("VENDOR_ROLE"), provider!),
  });
}

export interface AdminCourse extends CourseView {
  meta: CourseMeta | null;
}

export function useCourses() {
  const { read } = useContracts();
  const key = useAdminKey();
  return useQuery({
    queryKey: [...key, "courses"],
    enabled: Boolean(read),
    queryFn: async (): Promise<AdminCourse[]> => {
      const courses = await readAllCourses(read!.manager);
      const metas = await Promise.all(courses.map((c) => api.courseMeta(c.id).catch(() => null)));
      return courses.map((c, i) => ({ ...c, meta: metas[i] }));
    },
  });
}

export function useItems() {
  const { read } = useContracts();
  const key = useAdminKey();
  return useQuery({
    queryKey: [...key, "items"],
    enabled: Boolean(read),
    queryFn: async (): Promise<ItemView[]> => readAllItems(read!.store),
  });
}

export function courseName(course: Pick<AdminCourse, "code" | "meta">): string {
  return course.meta?.title ? `${course.code} · ${course.meta.title}` : course.code;
}

export function personName(name: string | null | undefined, fallback = "No profile"): string {
  return name?.trim() || fallback;
}

/** Why a wallet can't become a student, read live while the admin types it. */
export function useWalletCheck(wallet: string) {
  const { read } = useContracts();
  const key = useAdminKey();
  const valid = isAddress(wallet);
  return useQuery({
    queryKey: [...key, "wallet-check", valid ? getAddress(wallet) : ""],
    enabled: Boolean(read && valid),
    queryFn: async () => {
      const [studentId, teacher] = await Promise.all([
        read!.manager.studentIdOf(wallet),
        read!.manager.hasRole(keccakId("TEACHER_ROLE"), wallet),
      ]);
      return { studentId, teacher };
    },
  });
}

export function addressError(value: string): string | null {
  const v = value.trim();
  if (!v) return "Enter a wallet address.";
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) return "Enter a full 0x address, 42 characters long.";
  if (!isAddress(v)) return "The capitalisation doesn't match the address checksum. Paste it again or use all lowercase.";
  return null;
}
