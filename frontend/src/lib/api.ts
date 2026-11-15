import type { Signer } from "ethers";

export const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || "http://localhost:4000/api").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get isNetwork(): boolean {
    return this.status === 0;
  }
}

type Headers = Record<string, string>;

async function request<T>(path: string, init: RequestInit & { auth?: Headers } = {}): Promise<T> {
  const { auth, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`${BACKEND_URL}${path}`, {
      ...rest,
      headers: {
        Accept: "application/json",
        ...(rest.body ? { "Content-Type": "application/json" } : {}),
        ...auth,
        ...(headers as Headers | undefined),
      },
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Can't reach the AttendCoin server. Check that the backend is running.");
  }
  const text = await res.text();
  const body = text ? safeJson(text) : null;
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? `HTTP_${res.status}`, err?.message ?? res.statusText);
  }
  return body as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export interface Health {
  ok: boolean;
  chainId: number;
  blockNumber: number;
}

export interface BackendConfig {
  chainId: number;
  contracts: { AttendCoin: string; AttendanceManager: string; RewardStore: string };
  eip712Domain: { name: string; version: string; chainId: number; verifyingContract: string };
}

export interface CheckInSubmission {
  sessionId: string;
  student: string;
  issuedAt: number;
  ticketSig: string;
  studentSig: string;
}

export interface QueuedCheckIn {
  student: string;
  issuedAt: number;
  ticketSig: string;
  studentSig: string;
  studentId?: string | number;
  name?: string;
}

export type CheckInStatus = "queued" | "recorded" | "none";

export interface PublicProfile {
  wallet: string;
  name: string;
}

export interface AdminProfile extends PublicProfile {
  rollNumber: string;
  email?: string;
  idHash?: string;
  [key: string]: unknown;
}

export interface CourseMeta {
  title: string;
  room?: string;
  schedule?: string;
}

export const api = {
  health: () => request<Health>("/health"),
  config: () => request<BackendConfig>("/config"),

  submitCheckIn: (body: CheckInSubmission) =>
    request<{ status: "queued"; position: number }>("/checkins", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  sessionQueue: (sessionId: bigint | string) =>
    request<QueuedCheckIn[] | { checkins: QueuedCheckIn[] }>(`/sessions/${sessionId}/checkins`).then((r) =>
      Array.isArray(r) ? r : (r.checkins ?? []),
    ),

  checkInStatus: (sessionId: bigint | string, wallet: string) =>
    request<{ status: CheckInStatus }>(`/sessions/${sessionId}/checkins/${wallet}`),

  profile: (wallet: string) =>
    request<PublicProfile>(`/profiles/${wallet}`).catch((err: unknown) => {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }),

  profiles: (wallets: string[]) =>
    wallets.length === 0
      ? Promise.resolve([] as PublicProfile[])
      : request<PublicProfile[] | { profiles: PublicProfile[] }>(
          `/profiles?wallets=${wallets.map(encodeURIComponent).join(",")}`,
        ).then((r) => (Array.isArray(r) ? r : (r.profiles ?? []))),

  courseMeta: (courseId: bigint | string) =>
    request<CourseMeta>(`/courses/${courseId}/meta`).catch((err: unknown) => {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }),

  admin: {
    createProfile: (signer: Signer, body: { wallet: string; name: string; rollNumber: string; email?: string }) =>
      withAdminAuth(signer, (auth) =>
        request<{ wallet: string; idHash: string }>("/profiles", {
          method: "POST",
          body: JSON.stringify(body),
          auth,
        }),
      ),

    profiles: (signer: Signer) =>
      withAdminAuth(signer, (auth) =>
        request<AdminProfile[] | { profiles: AdminProfile[] }>("/admin/profiles", { auth }).then((r) =>
          Array.isArray(r) ? r : (r.profiles ?? []),
        ),
      ),

    setCourseMeta: (signer: Signer, courseId: bigint | string, meta: CourseMeta) =>
      withAdminAuth(signer, (auth) =>
        request<CourseMeta>(`/courses/${courseId}/meta`, {
          method: "PUT",
          body: JSON.stringify(meta),
          auth,
        }),
      ),
  },
};

const AUTH_TTL_MS = 4 * 60 * 1000;
const authCache = new Map<string, { headers: Headers; expires: number }>();
const pendingAuth = new Map<string, Promise<Headers>>();

export function adminAuthMessage(address: string, timestamp: number): string {
  return `AttendCoin admin request\nAddress: ${address}\nTimestamp: ${timestamp}`;
}

/**
 * Signed admin headers, reused for four minutes so the admin is not prompted on
 * every call. The server accepts five, which leaves a minute of clock slack.
 */
export async function adminAuthHeaders(signer: Signer): Promise<Headers> {
  const address = await signer.getAddress();
  const key = address.toLowerCase();
  const cached = authCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.headers;

  const inFlight = pendingAuth.get(key);
  if (inFlight) return inFlight;

  const promise = (async () => {
    const timestamp = Date.now();
    const signature = await signer.signMessage(adminAuthMessage(address, timestamp));
    const headers = {
      "x-auth-address": address,
      "x-auth-timestamp": String(timestamp),
      "x-auth-signature": signature,
    };
    authCache.set(key, { headers, expires: timestamp + AUTH_TTL_MS });
    return headers;
  })();
  pendingAuth.set(key, promise);
  try {
    return await promise;
  } finally {
    pendingAuth.delete(key);
  }
}

export function clearAdminAuth(address?: string): void {
  if (address) authCache.delete(address.toLowerCase());
  else authCache.clear();
}

async function withAdminAuth<T>(signer: Signer, call: (auth: Headers) => Promise<T>): Promise<T> {
  try {
    return await call(await adminAuthHeaders(signer));
  } catch (err) {
    // A rejected signature is likely stale (clock skew or a server restart); sign once more.
    if (err instanceof ApiError && err.status === 401) {
      clearAdminAuth(await signer.getAddress());
      return call(await adminAuthHeaders(signer));
    }
    throw err;
  }
}
