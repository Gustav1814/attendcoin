import { Wallet } from "ethers";

type KeyPair = { address: string; privateKey: string };

const KEY_PREFIX = "attendcoin.session-key.";
const PENDING_PREFIX = "attendcoin.session-key.pending.";
const REJECTED_PREFIX = "attendcoin.session-rejected.";

function get(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function set(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Private mode or quota: the key stays in memory for this page view only.
  }
}

function remove(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // nothing to clean up
  }
}

/**
 * Saved before openSession is sent, keyed by the signer address, so a reload
 * between sending and confirmation doesn't strand the session without its key.
 */
export function rememberPendingKey(wallet: KeyPair): void {
  set(PENDING_PREFIX + wallet.address.toLowerCase(), wallet.privateKey);
}

export function forgetPendingKey(address: string): void {
  remove(PENDING_PREFIX + address.toLowerCase());
}

export function saveSessionKey(sessionId: bigint, wallet: KeyPair): void {
  set(KEY_PREFIX + sessionId.toString(), wallet.privateKey);
  forgetPendingKey(wallet.address);
}

/** Returns the ticket key for a session only if it matches the signer registered on-chain. */
export function loadSessionKey(sessionId: bigint, signer: string): Wallet | null {
  const candidates = [KEY_PREFIX + sessionId.toString(), PENDING_PREFIX + signer.toLowerCase()];
  for (const storageKey of candidates) {
    const raw = get(storageKey);
    if (!raw) continue;
    try {
      const wallet = new Wallet(raw);
      if (wallet.address.toLowerCase() !== signer.toLowerCase()) continue;
      if (storageKey.startsWith(PENDING_PREFIX)) saveSessionKey(sessionId, wallet);
      return wallet;
    } catch {
      remove(storageKey);
    }
  }
  return null;
}

export function forgetSessionKey(sessionId: bigint): void {
  remove(KEY_PREFIX + sessionId.toString());
}

export interface RejectedCheckIn {
  ticketSig: string;
  student: string;
  name: string | null;
  reason: number;
}

/**
 * The relay only prunes entries once they are recorded on-chain, so a check-in
 * the contract refused would otherwise be offered for submission forever.
 */
export function loadRejected(sessionId: bigint): RejectedCheckIn[] {
  const raw = get(REJECTED_PREFIX + sessionId.toString());
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as RejectedCheckIn[]) : [];
  } catch {
    return [];
  }
}

export function saveRejected(sessionId: bigint, entries: RejectedCheckIn[]): void {
  set(REJECTED_PREFIX + sessionId.toString(), JSON.stringify(entries));
}
