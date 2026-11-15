import { ZeroHash, verifyMessage } from "ethers";
import { HttpError } from "./errors.js";

export const ADMIN_AUTH_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_ADMIN_ROLE = ZeroHash;

export function adminMessage(address, timestamp) {
  return `AttendCoin admin request\nAddress: ${address}\nTimestamp: ${timestamp}`;
}

export function requireAdmin(chain, { nowMs = Date.now } = {}) {
  return async (req, res, next) => {
    const address = req.get("x-auth-address");
    const timestamp = req.get("x-auth-timestamp");
    const signature = req.get("x-auth-signature");
    if (!address || !timestamp || !signature) {
      throw new HttpError(401, "auth_required", "Admin signature headers are missing");
    }

    const ts = Number(timestamp);
    if (!/^\d{1,16}$/.test(timestamp) || !Number.isSafeInteger(ts)) {
      throw new HttpError(401, "auth_invalid", "x-auth-timestamp must be unix milliseconds");
    }
    if (Math.abs(nowMs() - ts) > ADMIN_AUTH_WINDOW_MS) {
      throw new HttpError(401, "auth_expired", "Admin signature has expired, sign again");
    }

    let signer;
    try {
      // Verify against the header text exactly as sent, since that is what the wallet signed.
      signer = verifyMessage(adminMessage(address, timestamp), signature);
    } catch {
      throw new HttpError(401, "auth_invalid", "Admin signature could not be verified");
    }
    if (signer.toLowerCase() !== address.toLowerCase()) {
      throw new HttpError(401, "auth_invalid", "Admin signature does not match x-auth-address");
    }

    if (!(await chain.manager.hasRole(DEFAULT_ADMIN_ROLE, signer))) {
      throw new HttpError(403, "forbidden", "This wallet is not an admin");
    }
    req.admin = signer;
    next();
  };
}
