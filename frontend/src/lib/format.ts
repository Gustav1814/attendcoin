import { formatUnits, parseUnits } from "ethers";

export const ATC_DECIMALS = 18;
export const ATC_SYMBOL = "ATC";

const grouping = new Intl.NumberFormat("en-US");

/**
 * Formats a raw 18-decimal amount without going through floating point, so large
 * balances never pick up rounding noise. Fraction digits are trimmed, not padded.
 */
export function formatAtc(
  wei: bigint | null | undefined,
  { maxFractionDigits = 2, symbol = false }: { maxFractionDigits?: number; symbol?: boolean } = {},
): string {
  if (wei == null) return "—";
  const negative = wei < 0n;
  const [whole, fraction = ""] = formatUnits(negative ? -wei : wei, ATC_DECIMALS).split(".");
  let frac = fraction.slice(0, maxFractionDigits).replace(/0+$/, "");
  const smallNonZero = whole === "0" && frac === "" && wei !== 0n;
  if (smallNonZero) frac = "0".repeat(Math.max(0, maxFractionDigits - 1)) + "1";
  const body = `${grouping.format(BigInt(whole))}${frac ? `.${frac}` : ""}`;
  const text = `${negative ? "−" : ""}${smallNonZero ? "<" : ""}${body}`;
  return symbol ? `${text} ${ATC_SYMBOL}` : text;
}

/** Numeric value for display-only animation. Never use it for arithmetic on balances. */
export function atcToNumber(wei: bigint | null | undefined): number {
  if (wei == null) return 0;
  return Number(formatUnits(wei, ATC_DECIMALS));
}

export function parseAtc(value: string): bigint {
  return parseUnits(value.trim() || "0", ATC_DECIMALS);
}

export function formatInteger(n: number | bigint | null | undefined): string {
  if (n == null) return "—";
  return grouping.format(n);
}

export function ratio(part: number, whole: number): number | null {
  if (!whole) return null;
  return Math.min(1, Math.max(0, part / whole));
}

export function formatPercent(value: number | null | undefined, fractionDigits = 0): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(fractionDigits)}%`;
}

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

/** Accepts unix seconds (contract timestamps) or a Date. */
export function formatDate(value: number | bigint | Date | null | undefined): string {
  const d = toDate(value);
  return d ? dateFmt.format(d) : "—";
}

export function formatDateTime(value: number | bigint | Date | null | undefined): string {
  const d = toDate(value);
  return d ? dateTimeFmt.format(d) : "—";
}

export function formatTime(value: number | bigint | Date | null | undefined): string {
  const d = toDate(value);
  return d ? timeFmt.format(d) : "—";
}

const relativeFmt = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function formatRelative(value: number | bigint | Date | null | undefined, now = Date.now()): string {
  const d = toDate(value);
  if (!d) return "—";
  const seconds = Math.round((d.getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return seconds <= 0 ? "just now" : "in a moment";
  if (abs < 3600) return relativeFmt.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return relativeFmt.format(Math.round(seconds / 3600), "hour");
  if (abs < 7 * 86_400) return relativeFmt.format(Math.round(seconds / 86_400), "day");
  return formatDate(d);
}

/** "4m 05s", "52s". For countdowns and session windows. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

export function shortAddress(address: string | null | undefined, chars = 4): string {
  if (!address) return "";
  return `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`;
}

export function shortHash(hash: string | null | undefined): string {
  if (!hash) return "";
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${formatInteger(n)} ${n === 1 ? one : many}`;
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function toDate(value: number | bigint | Date | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return value;
  const n = Number(value);
  if (!n) return null;
  return new Date(n * 1000);
}
