# AttendCoin backend

Express API that sits between the student app and the teacher dashboard. It checks QR check-ins before they are queued, holds the queue until the teacher submits it on-chain, and stores off-chain profile and course details. It never holds a private key: all writes to the chain are made by the teacher's or admin's wallet in the browser.

## Setup

Needs Node 24.

```sh
cd backend
npm install
cp .env.example .env
npm run dev        # restarts on file changes
npm start
```

The server reads contract addresses from `src/deployment.<NETWORK>.json`, which `scripts/deploy.js` writes. Deploy first (`npm run node` and `npm run deploy:local` from the project root), otherwise the server exits with a message saying which file is missing.

## Environment

| Variable | Default | |
|---|---|---|
| `PORT` | `4000` | |
| `RPC_URL` | `http://127.0.0.1:8545` | JSON-RPC node used for reads |
| `NETWORK` | `localhost` | picks `src/deployment.<NETWORK>.json` |
| `ID_SALT` | `attendcoin-dev-salt` | secret behind student `idHash`; change it for any real deployment |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | allowed CORS origin, comma-separated for several |
| `DATA_DIR` | `./data` | where `db.json` lives, relative to `backend/` |

`idHash` is `keccak256(abi.encodePacked(salt, rollNumber))` with `salt = keccak256(utf8(ID_SALT))` and the roll number trimmed. `scripts/seed.js` must use the same `ID_SALT`.

## Endpoints

All paths are under `/api`. Errors look like `{ "error": { "code", "message" } }`.

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/health` | | `{ ok, chainId, blockNumber }`, 503 if the node is down |
| GET | `/config` | | `{ chainId, contracts, eip712Domain }` |
| POST | `/checkins` | | `201 { status: "queued", position }` |
| GET | `/sessions/:id/checkins` | | `{ sessionId, checkins: [{ student, issuedAt, ticketSig, studentSig, studentId, name? }] }` |
| GET | `/sessions/:id/checkins/:wallet` | | `{ status: "queued" \| "recorded" \| "none" }` |
| POST | `/profiles` | admin | `201 { wallet, idHash }` (200 when updating) |
| GET | `/profiles/:wallet` | | `{ wallet, name }` |
| GET | `/profiles?wallets=a,b` | | `{ profiles: [{ wallet, name }] }` (unknown wallets are left out) |
| GET | `/admin/profiles` | admin | `{ profiles: [full record] }` |
| PUT | `/courses/:id/meta` | admin | `{ courseId, title, room?, schedule?, updatedAt }` |
| GET | `/courses/:id/meta` | | same as above |

`POST /checkins` is rate limited to 120 requests per minute per IP. A classroom often shares one NAT address, so the limit is loose on purpose.

Check-in rejections:

| Status | Code | Why |
|---|---|---|
| 400 | `validation_failed` | malformed body |
| 404 | `session_not_found` | |
| 409 | `session_closed` | finalized or past the submission grace period |
| 422 | `ticket_expired` | `issuedAt` more than 30 s before the server clock |
| 422 | `ticket_not_yet_valid` | `issuedAt` more than 5 s after the server clock |
| 422 | `outside_window` | `issuedAt` outside the session's open/close times |
| 422 | `bad_ticket` | ticket not signed by the session signer |
| 422 | `bad_student_signature` | CheckIn not signed by `student` (EOA or ERC-1271) |
| 403 | `not_registered` | wallet unknown or student inactive |
| 403 | `not_enrolled` | |
| 409 | `already_recorded` | attendance already on-chain |
| 409 | `already_queued` | |
| 429 | `rate_limited` | |

### Admin auth

Send three headers: `x-auth-address`, `x-auth-timestamp` (unix ms) and `x-auth-signature`, a `personal_sign` of

```
AttendCoin admin request
Address: <x-auth-address as sent>
Timestamp: <x-auth-timestamp>
```

The timestamp must be within 5 minutes of the server clock and the signer must hold `DEFAULT_ADMIN_ROLE` on AttendanceManager. Missing, malformed or mismatched headers give 401 (`auth_required`, `auth_invalid`, `auth_expired`); a valid signature from a non-admin gives 403 `forbidden`.

## Storage

Everything lives in `DATA_DIR/db.json`. Writes go through one in-process queue and are written to a temp file, synced, then renamed over the old file, so a crash never leaves a half-written file. Run a single server process per data directory.
