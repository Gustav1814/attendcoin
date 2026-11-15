import { useQuery } from "@tanstack/react-query";
import { id as keccakId } from "ethers";
import { ROLE } from "./contracts";
import { useChainKey, useContracts, useWallet } from "./wallet";

export type Role = "student" | "teacher" | "admin" | "vendor";

export const ROLE_ORDER: Role[] = ["student", "teacher", "vendor", "admin"];

export const ROLE_LABEL: Record<Role, string> = {
  student: "Student",
  teacher: "Teacher",
  admin: "Admin",
  vendor: "Vendor",
};

export const TEACHER_ROLE = keccakId("TEACHER_ROLE");
export const VENDOR_ROLE = keccakId("VENDOR_ROLE");
export const STORE_MANAGER_ROLE = keccakId("STORE_MANAGER_ROLE");

export interface RoleInfo {
  roles: Role[];
  has: Record<Role, boolean>;
  /** 0n when the wallet isn't a registered student. */
  studentId: bigint;
  /** False while roles are being read or when there is nothing to read. */
  ready: boolean;
  isLoading: boolean;
  error: Error | null;
  refetch(): void;
}

const NONE: Record<Role, boolean> = { student: false, teacher: false, admin: false, vendor: false };

/**
 * Reads the connected wallet's roles from chain, per SPEC: admin and teacher on
 * AttendanceManager, vendor on RewardStore, student when `studentIdOf != 0`.
 */
export function useRoles(): RoleInfo {
  const { address } = useWallet();
  const { read } = useContracts();
  const key = useChainKey();

  const query = useQuery({
    queryKey: [...key, "roles"],
    enabled: Boolean(address && read),
    staleTime: 30_000,
    queryFn: async () => {
      const { manager, store } = read!;
      const [admin, teacher, vendor, studentId] = await Promise.all([
        manager.hasRole(ROLE.DEFAULT_ADMIN, address!),
        manager.hasRole(TEACHER_ROLE, address!),
        store.hasRole(VENDOR_ROLE, address!),
        manager.studentIdOf(address!),
      ]);
      return { has: { admin, teacher, vendor, student: studentId !== 0n }, studentId };
    },
  });

  const has = query.data?.has ?? NONE;
  return {
    roles: ROLE_ORDER.filter((r) => has[r]),
    has,
    studentId: query.data?.studentId ?? 0n,
    ready: query.isSuccess,
    isLoading: query.isLoading,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}

export function homePathFor(role: Role): string {
  return `/${role}`;
}
