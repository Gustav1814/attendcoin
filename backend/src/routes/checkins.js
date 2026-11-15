import { Router } from "express";
import { keccak256 } from "ethers";
import { HttpError } from "../errors.js";
import { address, checkInBody, parse, uintId } from "../validation.js";

export const TICKET_MAX_AGE = 30;
export const TICKET_MAX_SKEW = 5;

async function loadSession(manager, sessionId) {
  const count = await manager.sessionCount();
  if (sessionId > count) throw new HttpError(404, "session_not_found", `Session ${sessionId} does not exist`);
  return manager.getSession(sessionId);
}

export function checkinRoutes({ chain, store, nowSeconds, rateLimiter }) {
  const router = Router();
  const { manager } = chain;

  router.post("/checkins", rateLimiter, async (req, res) => {
    const body = parse(checkInBody, req.body, "body");
    const { sessionId, student, issuedAt, ticketSig, studentSig } = body;

    const now = nowSeconds();
    if (issuedAt < now - TICKET_MAX_AGE) {
      throw new HttpError(422, "ticket_expired", "This QR code has expired. Scan the current one.");
    }
    if (issuedAt > now + TICKET_MAX_SKEW) {
      throw new HttpError(422, "ticket_not_yet_valid", "Ticket time is in the future. Check your device clock.");
    }

    const session = await loadSession(manager, sessionId);
    if (!(await manager.isAcceptingAttendance(sessionId))) {
      throw new HttpError(409, "session_closed", "This session is no longer accepting attendance");
    }
    if (BigInt(issuedAt) < session.openedAt || BigInt(issuedAt) > session.closesAt) {
      throw new HttpError(422, "outside_window", "Ticket was issued outside the session window");
    }

    const ticketSigner = chain.recoverTicketSigner({ sessionId, issuedAt }, ticketSig);
    if (ticketSigner?.toLowerCase() !== session.signer.toLowerCase()) {
      throw new HttpError(422, "bad_ticket", "QR code was not issued for this session");
    }

    const checkIn = { sessionId, student, issuedAt, ticketHash: keccak256(ticketSig) };
    if (!(await chain.isValidCheckInSignature(checkIn, studentSig))) {
      throw new HttpError(422, "bad_student_signature", "Check-in was not signed by this wallet");
    }

    const studentId = await manager.studentIdOf(student);
    if (studentId === 0n) throw new HttpError(403, "not_registered", "This wallet is not a registered student");
    const [record, enrolled, attended] = await Promise.all([
      manager.getStudent(studentId),
      manager.isEnrolled(session.courseId, studentId),
      manager.attended(sessionId, studentId),
    ]);
    if (!record.active) throw new HttpError(403, "not_registered", "This student account is inactive");
    if (!enrolled) throw new HttpError(403, "not_enrolled", "You are not enrolled in this course");
    if (attended) throw new HttpError(409, "already_recorded", "Your attendance is already recorded");

    const key = sessionId.toString();
    const position = await store.update((state) => {
      const queue = (state.checkins[key] ??= []);
      if (queue.some((entry) => entry.student === student)) {
        throw new HttpError(409, "already_queued", "You have already checked in to this session");
      }
      queue.push({
        student,
        studentId: Number(studentId),
        issuedAt,
        ticketSig,
        studentSig,
        receivedAt: new Date().toISOString(),
      });
      return queue.length;
    });

    res.status(201).json({ status: "queued", position });
  });

  // Entries leave the queue once the contract has dealt with them: recorded, or
  // rejected by a submitCheckIns that ran after the ticket was issued. A student
  // can re-scan after a rejection, so older rejections don't drop a newer entry.
  async function settledQueue(sessionId) {
    const key = sessionId.toString();
    const queued = store.read().checkins[key] ?? [];
    if (queued.length === 0) return queued;

    const [recorded, rejections] = await Promise.all([
      Promise.all(queued.map((entry) => manager.attended(sessionId, entry.studentId))),
      manager.queryFilter(manager.filters.CheckInRejected(sessionId), chain.fromBlock),
    ]);
    const rejectedAt = new Map();
    for (const log of rejections) {
      const { timestamp } = await log.getBlock();
      const student = log.args.student.toLowerCase();
      rejectedAt.set(student, Math.max(rejectedAt.get(student) ?? 0, timestamp));
    }
    const entryKey = (entry) => `${entry.student.toLowerCase()}:${entry.issuedAt}`;
    const done = new Set(
      queued
        .filter((entry, i) => recorded[i] || entry.issuedAt <= (rejectedAt.get(entry.student.toLowerCase()) ?? -1))
        .map(entryKey),
    );
    if (done.size === 0) return queued;

    return store.update((state) => {
      const remaining = (state.checkins[key] ?? []).filter((entry) => !done.has(entryKey(entry)));
      if (remaining.length) state.checkins[key] = remaining;
      else delete state.checkins[key];
      return remaining;
    });
  }

  router.get("/sessions/:id/checkins", async (req, res) => {
    const sessionId = parse(uintId, req.params.id, "id");
    const key = sessionId.toString();
    const pending = await settledQueue(sessionId);

    const profiles = store.read().profiles;
    res.json({
      sessionId: key,
      checkins: pending.map(({ student, studentId, issuedAt, ticketSig, studentSig }) => ({
        student,
        issuedAt,
        ticketSig,
        studentSig,
        studentId,
        ...(profiles[student.toLowerCase()] && { name: profiles[student.toLowerCase()].name }),
      })),
    });
  });

  router.get("/sessions/:id/checkins/:wallet", async (req, res) => {
    const sessionId = parse(uintId, req.params.id, "id");
    const wallet = parse(address, req.params.wallet, "wallet");

    const studentId = await manager.studentIdOf(wallet);
    if (studentId !== 0n && (await manager.attended(sessionId, studentId))) {
      return res.json({ status: "recorded" });
    }
    const queue = await settledQueue(sessionId);
    res.json({ status: queue.some((entry) => entry.student === wallet) ? "queued" : "none" });
  });

  return router;
}
