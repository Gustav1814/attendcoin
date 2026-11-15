import { z } from "zod";
import { getAddress, isAddress } from "ethers";
import { HttpError } from "./errors.js";

const MAX_UINT64 = 2n ** 64n - 1n;

export const address = z
  .string()
  .trim()
  .refine((value) => isAddress(value), "must be a valid address")
  .transform((value) => getAddress(value));

// uint256 ids arrive as JSON numbers or decimal strings (query params, QR codes).
export const uintId = z
  .union([z.number().int().positive().max(Number.MAX_SAFE_INTEGER), z.string().regex(/^[1-9]\d{0,76}$/)])
  .transform((value) => BigInt(value));

const unixSeconds = z
  .union([z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), z.string().regex(/^\d{1,20}$/)])
  .transform((value) => BigInt(value))
  .refine((value) => value <= MAX_UINT64, "must fit in uint64")
  .transform((value) => Number(value));

const ecdsaSignature = z
  .string()
  .regex(/^0x[0-9a-fA-F]{130}$/, "must be a 65-byte hex signature")
  .transform((value) => value.toLowerCase());

// Smart-contract wallets may return signatures of any length.
const anySignature = z
  .string()
  .regex(/^0x(?:[0-9a-fA-F]{2}){1,2048}$/, "must be a hex signature")
  .transform((value) => value.toLowerCase());

export const checkInBody = z.object({
  sessionId: uintId,
  student: address,
  issuedAt: unixSeconds,
  ticketSig: ecdsaSignature,
  studentSig: anySignature,
});

export const profileBody = z.object({
  wallet: address,
  name: z.string().trim().min(1).max(100),
  rollNumber: z.string().trim().min(1).max(64),
  email: z
    .union([z.literal(""), z.email().max(254)])
    .optional()
    .transform((value) => value || undefined),
});

export const courseMetaBody = z.object({
  title: z.string().trim().min(1).max(120),
  room: z.string().trim().max(60).optional(),
  schedule: z.string().trim().max(200).optional(),
});

export const walletList = z
  .string()
  .transform((value) => value.split(",").map((part) => part.trim()).filter(Boolean))
  .pipe(z.array(address).min(1).max(100));

export function parse(schema, data, label = "request") {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const where = issue.path.length ? issue.path.join(".") : label;
  throw new HttpError(400, "validation_failed", `${where}: ${issue.message}`);
}
