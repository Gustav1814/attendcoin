import { Interface, isError } from "ethers";
import { ApiError } from "./api";
import { abis } from "./contracts";

const interfaces = [abis.AttendanceManager, abis.RewardStore, abis.AttendCoin].map((abi) => new Interface(abi));

const REVERT_MESSAGES: Record<string, string> = {
  NotRegistered: "This wallet isn't registered as a student.",
  NotAllowed: "This wallet isn't allowed to do that.",
  NotPending: "That redemption is no longer pending.",
  ItemUnavailable: "That reward isn't available right now.",
  OutOfStock: "That reward just sold out.",
  LimitReached: "You've reached the limit for this reward.",
  InvalidId: "That record doesn't exist on-chain.",
  InvalidItem: "The reward details are invalid.",
  EnforcedPause: "The contract is paused by an admin. Try again later.",
  ERC20InsufficientBalance: "Not enough ATC in this wallet.",
  ERC20InsufficientAllowance: "The store isn't approved to take this amount yet.",
  TransferNotAllowed: "This wallet isn't on the campus allowlist for transfers.",
  AccessControlUnauthorizedAccount: "This wallet doesn't have the role needed for that.",
  NotATeacher: "That wallet doesn't have the teacher role.",
  NotCourseTeacher: "Only the course's teacher can do that.",
  CourseInactive: "That course is inactive.",
  InvalidDuration: "Session length must be between 5 minutes and 4 hours.",
  PreviousSessionPending: "Finalize the previous session for this course first.",
  SessionTooSoon: "Sessions for a course must start at least 4 hours apart.",
  TeacherCannotBeStudent: "A teacher's wallet can't be registered or enrolled as a student.",
  SessionNotAcceptingAttendance: "That session is closed.",
  SessionAlreadyFinalized: "That session is already finalized.",
  BatchTooLarge: "Too many entries in one batch. The limit is 100.",
  LengthMismatch: "The lists have different lengths.",
  AlreadyRegistered: "That wallet is already registered.",
  IdHashUsed: "That roll number is already linked to a wallet.",
  InvalidCode: "Course code must be 1 to 32 characters.",
  InvalidRewardConfig: "Those reward settings are outside the allowed range.",
  ZeroAddress: "An address is missing.",
  ERC20ExceededCap: "The ATC supply cap has been reached.",
  ERC2612ExpiredSignature: "The permit expired. Try again.",
  ERC2612InvalidSigner: "The permit signature didn't match.",
};

export interface FriendlyError {
  title: string;
  message: string;
  /** The user dismissed the wallet prompt; usually not worth a red banner. */
  rejected: boolean;
  revertName?: string;
}

export function describeError(err: unknown): FriendlyError {
  if (isUserRejection(err)) {
    return { title: "Request cancelled", message: "You declined the request in your wallet.", rejected: true };
  }

  if (err instanceof ApiError) {
    return {
      title: err.isNetwork ? "Server unreachable" : "Request failed",
      message: err.message,
      rejected: false,
    };
  }

  const revertName = revertNameOf(err);
  if (revertName) {
    return {
      title: "Transaction reverted",
      message: REVERT_MESSAGES[revertName] ?? `The contract rejected this (${revertName}).`,
      rejected: false,
      revertName,
    };
  }

  if (isError(err, "INSUFFICIENT_FUNDS")) {
    return {
      title: "Not enough ETH for gas",
      message: "Top up this wallet with a little ETH to pay the network fee.",
      rejected: false,
    };
  }
  if (isError(err, "NETWORK_ERROR") || isError(err, "SERVER_ERROR") || isError(err, "TIMEOUT")) {
    return {
      title: "Network problem",
      message: "The blockchain node didn't respond. Check your connection and try again.",
      rejected: false,
    };
  }

  const message =
    (err as { shortMessage?: string })?.shortMessage ??
    (err as { reason?: string })?.reason ??
    (err instanceof Error ? err.message : String(err));
  return { title: "Something went wrong", message: trimMessage(message), rejected: false };
}

export function isUserRejection(err: unknown): boolean {
  if (isError(err, "ACTION_REJECTED")) return true;
  const code = (err as { code?: unknown; info?: { error?: { code?: unknown } } })?.code;
  const inner = (err as { info?: { error?: { code?: unknown } } })?.info?.error?.code;
  return code === 4001 || inner === 4001;
}

function revertNameOf(err: unknown): string | undefined {
  const e = err as { revert?: { name?: string }; data?: unknown; info?: { error?: { data?: unknown } } };
  if (e?.revert?.name) return e.revert.name;
  const data = findRevertData(e);
  if (!data) return undefined;
  for (const iface of interfaces) {
    try {
      const parsed = iface.parseError(data);
      if (parsed) return parsed.name;
    } catch {
      // try the next contract's errors
    }
  }
  return undefined;
}

function findRevertData(e: unknown, depth = 0): string | undefined {
  if (!e || typeof e !== "object" || depth > 4) return undefined;
  const obj = e as Record<string, unknown>;
  if (typeof obj.data === "string" && obj.data.startsWith("0x") && obj.data.length >= 10) return obj.data;
  for (const key of ["data", "error", "info", "cause"]) {
    const found = findRevertData(obj[key], depth + 1);
    if (found) return found;
  }
  return undefined;
}

function trimMessage(message: string): string {
  const cut = message.split(" (action=")[0].split("\n")[0];
  return cut.length > 180 ? `${cut.slice(0, 177)}…` : cut;
}
