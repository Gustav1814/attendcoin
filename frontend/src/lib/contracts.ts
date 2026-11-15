import { Contract, JsonRpcProvider, Network, type ContractRunner, type Provider } from "ethers";
import attendCoinAbi from "@/contracts/abi/AttendCoin.json";
import attendanceManagerAbi from "@/contracts/abi/AttendanceManager.json";
import rewardStoreAbi from "@/contracts/abi/RewardStore.json";
import type {
  AttendCoinContract,
  AttendanceManagerContract,
  RewardStoreContract,
} from "@/contracts/types";

export type {
  AttendCoinContract,
  AttendanceManagerContract,
  RewardStoreContract,
} from "@/contracts/types";

export const abis = {
  AttendCoin: attendCoinAbi,
  AttendanceManager: attendanceManagerAbi,
  RewardStore: rewardStoreAbi,
} as const;

export interface Deployment {
  network: string;
  chainId: number;
  admin: string;
  treasury: string;
  deployedAt?: string;
  deployBlock?: number;
  contracts: {
    AttendCoin: string;
    AttendanceManager: string;
    RewardStore: string;
  };
}

interface ChainInfo {
  chainId: number;
  name: string;
  rpcUrl?: string;
  explorer?: string;
}

const KNOWN_CHAINS: Record<string, ChainInfo> = {
  localhost: { chainId: 31337, name: "Localhost", rpcUrl: "http://127.0.0.1:8545" },
  hardhat: { chainId: 31337, name: "Hardhat", rpcUrl: "http://127.0.0.1:8545" },
  sepolia: { chainId: 11155111, name: "Sepolia", explorer: "https://sepolia.etherscan.io" },
};

const deploymentFiles = import.meta.glob<Deployment>("../contracts/deployment.*.json", {
  eager: true,
  import: "default",
});

export const NETWORK = import.meta.env.VITE_NETWORK || "localhost";

export const deployment: Deployment | null =
  deploymentFiles[`../contracts/deployment.${NETWORK}.json`] ?? null;

const known = KNOWN_CHAINS[NETWORK];

export const chain: ChainInfo = {
  chainId: deployment?.chainId ?? known?.chainId ?? 31337,
  name: known?.name ?? NETWORK.charAt(0).toUpperCase() + NETWORK.slice(1),
  rpcUrl: import.meta.env.VITE_RPC_URL || known?.rpcUrl,
  explorer: known?.explorer,
};

export const isLocalChain = chain.chainId === 31337;

export function explorerTxUrl(hash: string): string | null {
  return chain.explorer ? `${chain.explorer}/tx/${hash}` : null;
}

export function explorerAddressUrl(address: string): string | null {
  return chain.explorer ? `${chain.explorer}/address/${address}` : null;
}

export function chainName(chainId: number | null | undefined): string {
  if (chainId == null) return "Unknown";
  const match = Object.values(KNOWN_CHAINS).find((c) => c.chainId === chainId);
  if (match) return match.name;
  if (chainId === 1) return "Ethereum";
  return `Chain ${chainId}`;
}

let fallbackProvider: JsonRpcProvider | null = null;

/** Read-only provider for the configured network, used before a wallet is on the right chain. */
export function getFallbackProvider(): JsonRpcProvider | null {
  if (!chain.rpcUrl) return null;
  if (!fallbackProvider) {
    fallbackProvider = new JsonRpcProvider(chain.rpcUrl, Network.from(chain.chainId), {
      staticNetwork: true,
      pollingInterval: isLocalChain ? 1000 : 4000,
    });
  }
  return fallbackProvider;
}

export interface Contracts {
  token: AttendCoinContract;
  manager: AttendanceManagerContract;
  store: RewardStoreContract;
}

export function getContracts(runner: ContractRunner): Contracts {
  if (!deployment) throw new Error(`No deployment file for network "${NETWORK}"`);
  const { contracts } = deployment;
  return {
    token: new Contract(contracts.AttendCoin, abis.AttendCoin, runner) as unknown as AttendCoinContract,
    manager: new Contract(
      contracts.AttendanceManager,
      abis.AttendanceManager,
      runner,
    ) as unknown as AttendanceManagerContract,
    store: new Contract(contracts.RewardStore, abis.RewardStore, runner) as unknown as RewardStoreContract,
  };
}

/**
 * First block worth scanning for events. Public RPCs cap log ranges, so on
 * remote chains without a known deploy block we only look back a bounded window.
 */
export async function logsFromBlock(provider: Provider): Promise<number> {
  const fromEnv = Number(import.meta.env.VITE_LOGS_FROM_BLOCK);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  if (deployment?.deployBlock != null) return deployment.deployBlock;
  if (isLocalChain) return 0;
  const latest = await provider.getBlockNumber();
  return Math.max(0, latest - 45_000);
}

export const ROLE = {
  DEFAULT_ADMIN: "0x0000000000000000000000000000000000000000000000000000000000000000",
} as const;

export const REJECT_REASONS: Record<number, string> = {
  1: "Not registered",
  2: "Not enrolled",
  3: "Already recorded",
  4: "Invalid or expired code",
  5: "Signature did not match",
  6: "Outside the session window",
};

export enum RedemptionStatus {
  None = 0,
  Pending = 1,
  Fulfilled = 2,
  Cancelled = 3,
}

export interface CourseView {
  id: bigint;
  code: string;
  teacher: string;
  active: boolean;
  sessionCount: number;
  enrolledCount: number;
}

export interface SessionView {
  id: bigint;
  courseId: bigint;
  index: number;
  signer: string;
  openedAt: number;
  closesAt: number;
  finalized: boolean;
  attendeeCount: number;
}

export interface StatsView {
  attended: number;
  lastAttendedIndex: number;
  streak: number;
  bestStreak: number;
}

export interface ItemView {
  id: bigint;
  name: string;
  metadataURI: string;
  price: bigint;
  stock: number;
  perStudentLimit: number;
  active: boolean;
}

export interface RedemptionView {
  id: bigint;
  itemId: bigint;
  student: string;
  price: bigint;
  createdAt: number;
  settledAt: number;
  status: RedemptionStatus;
}

export async function readCourse(manager: AttendanceManagerContract, id: bigint): Promise<CourseView> {
  const c = await manager.getCourse(id);
  return {
    id,
    code: c.code,
    teacher: c.teacher,
    active: c.active,
    sessionCount: Number(c.sessionCount),
    enrolledCount: Number(c.enrolledCount),
  };
}

export async function readSession(manager: AttendanceManagerContract, id: bigint): Promise<SessionView> {
  const s = await manager.getSession(id);
  return {
    id,
    courseId: s.courseId,
    index: Number(s.index),
    signer: s.signer,
    openedAt: Number(s.openedAt),
    closesAt: Number(s.closesAt),
    finalized: s.finalized,
    attendeeCount: Number(s.attendeeCount),
  };
}

export async function readStats(
  manager: AttendanceManagerContract,
  courseId: bigint,
  studentId: bigint,
): Promise<StatsView> {
  const s = await manager.getStats(courseId, studentId);
  return {
    attended: Number(s.attended),
    lastAttendedIndex: Number(s.lastAttendedIndex),
    streak: Number(s.streak),
    bestStreak: Number(s.bestStreak),
  };
}

export async function readItem(store: RewardStoreContract, id: bigint): Promise<ItemView> {
  const it = await store.getItem(id);
  return {
    id,
    name: it.name,
    metadataURI: it.metadataURI,
    price: it.price,
    stock: Number(it.stock),
    perStudentLimit: Number(it.perStudentLimit),
    active: it.active,
  };
}

export async function readRedemption(store: RewardStoreContract, id: bigint): Promise<RedemptionView> {
  const r = await store.getRedemption(id);
  return {
    id,
    itemId: r.itemId,
    student: r.student,
    price: r.price,
    createdAt: Number(r.createdAt),
    settledAt: Number(r.settledAt),
    status: Number(r.status) as RedemptionStatus,
  };
}

export async function readAllCourses(manager: AttendanceManagerContract): Promise<CourseView[]> {
  const count = await manager.courseCount();
  return Promise.all(range(count).map((id) => readCourse(manager, id)));
}

export async function readAllItems(store: RewardStoreContract): Promise<ItemView[]> {
  const count = await store.itemCount();
  return Promise.all(range(count).map((id) => readItem(store, id)));
}

/** 1-based ids up to and including `count`, matching how the contracts number records. */
export function range(count: bigint | number): bigint[] {
  const n = Number(count);
  return Array.from({ length: n }, (_, i) => BigInt(i + 1));
}
