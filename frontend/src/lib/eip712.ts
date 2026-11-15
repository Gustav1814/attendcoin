import {
  Signature,
  keccak256,
  verifyTypedData,
  type BigNumberish,
  type Signer,
  type TypedDataDomain,
} from "ethers";

export const ATTENDANCE_DOMAIN_NAME = "AttendCoin Attendance";
export const ATTENDANCE_DOMAIN_VERSION = "1";

export function attendanceDomain(chainId: number | bigint, verifyingContract: string): TypedDataDomain {
  return {
    name: ATTENDANCE_DOMAIN_NAME,
    version: ATTENDANCE_DOMAIN_VERSION,
    chainId,
    verifyingContract,
  };
}

export const TICKET_TYPES = {
  Ticket: [
    { name: "sessionId", type: "uint256" },
    { name: "issuedAt", type: "uint64" },
  ],
};

export const CHECKIN_TYPES = {
  CheckIn: [
    { name: "sessionId", type: "uint256" },
    { name: "student", type: "address" },
    { name: "issuedAt", type: "uint64" },
    { name: "ticketHash", type: "bytes32" },
  ],
};

export interface Ticket {
  sessionId: bigint;
  issuedAt: number;
  ticketSig: string;
}

/** Signed by the teacher's ephemeral session key. */
export function signTicket(
  signer: Signer,
  domain: TypedDataDomain,
  sessionId: BigNumberish,
  issuedAt: number,
): Promise<string> {
  return signer.signTypedData(domain, TICKET_TYPES, { sessionId, issuedAt });
}

export function recoverTicketSigner(domain: TypedDataDomain, ticket: Ticket): string {
  return verifyTypedData(
    domain,
    TICKET_TYPES,
    { sessionId: ticket.sessionId, issuedAt: ticket.issuedAt },
    ticket.ticketSig,
  );
}

export function ticketHash(ticketSig: string): string {
  return keccak256(ticketSig);
}

/** Signed by the student's wallet. Free: no transaction is sent. */
export function signCheckIn(
  signer: Signer,
  domain: TypedDataDomain,
  args: { sessionId: BigNumberish; student: string; issuedAt: number; ticketSig: string },
): Promise<string> {
  return signer.signTypedData(domain, CHECKIN_TYPES, {
    sessionId: args.sessionId,
    student: args.student,
    issuedAt: args.issuedAt,
    ticketHash: ticketHash(args.ticketSig),
  });
}

export const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

/** EIP-2612 permit for AttendCoin. Domain name matches `ERC20Permit("AttendCoin")`. */
export async function signPermit(
  signer: Signer,
  args: {
    chainId: number | bigint;
    token: string;
    owner: string;
    spender: string;
    value: bigint;
    nonce: bigint;
    deadline: bigint;
  },
): Promise<Signature> {
  const domain: TypedDataDomain = {
    name: "AttendCoin",
    version: "1",
    chainId: args.chainId,
    verifyingContract: args.token,
  };
  const raw = await signer.signTypedData(domain, PERMIT_TYPES, {
    owner: args.owner,
    spender: args.spender,
    value: args.value,
    nonce: args.nonce,
    deadline: args.deadline,
  });
  return Signature.from(raw);
}

export function buildCheckinUrl(origin: string, ticket: Ticket): string {
  const params = new URLSearchParams({
    s: ticket.sessionId.toString(),
    t: String(ticket.issuedAt),
    sig: ticket.ticketSig,
  });
  return `${origin.replace(/\/$/, "")}/checkin?${params}`;
}

/** Accepts a full check-in URL, a bare query string, or URLSearchParams. */
export function parseCheckinPayload(input: string | URLSearchParams): Ticket | null {
  let params: URLSearchParams;
  if (typeof input === "string") {
    const text = input.trim();
    const q = text.indexOf("?");
    params = new URLSearchParams(q >= 0 ? text.slice(q + 1) : text);
  } else {
    params = input;
  }
  const s = params.get("s");
  const t = params.get("t");
  const sig = params.get("sig");
  if (!s || !t || !sig) return null;
  if (!/^\d+$/.test(s) || !/^\d+$/.test(t) || !/^0x[0-9a-fA-F]{130}$/.test(sig)) return null;
  return { sessionId: BigInt(s), issuedAt: Number(t), ticketSig: sig };
}

const REDEMPTION_PREFIX = "attendcoin:redemption:";

/** QR content a student shows at the counter. */
export function redemptionQrPayload(redemptionId: bigint | number): string {
  return `${REDEMPTION_PREFIX}${redemptionId}`;
}

/** Accepts the QR payload or a bare id typed by hand. */
export function parseRedemptionQr(text: string): bigint | null {
  const value = text.trim().toLowerCase();
  const raw = value.startsWith(REDEMPTION_PREFIX) ? value.slice(REDEMPTION_PREFIX.length) : value.replace(/^#/, "");
  return /^\d+$/.test(raw) && raw !== "0" ? BigInt(raw) : null;
}
