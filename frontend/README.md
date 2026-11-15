# AttendCoin frontend

React 18, TypeScript and Vite, with ethers v6 for chain access and React Query for caching.

## Setup

```sh
cp .env.example .env
npm install
npm run dev        # http://localhost:5173
```

The app reads contract addresses from `src/contracts/deployment.<VITE_NETWORK>.json`, which the
root deploy script writes. Until that file exists, role pages show a "not deployed" notice.

| Variable | Purpose |
| --- | --- |
| `VITE_NETWORK` | `localhost`, `hardhat` or `sepolia`. Picks the deployment file and chain. |
| `VITE_BACKEND_URL` | Base URL of the API, including `/api`. |
| `VITE_RPC_URL` | Read RPC used before a wallet connects. Required for Sepolia. |
| `VITE_DEV_WALLETS` | `true` lists the Hardhat test accounts in the connect panel (local chain only). |
| `VITE_LOGS_FROM_BLOCK` | First block to scan for events. Falls back to `deployBlock`, then 0. |

## Scripts

- `npm run build` type-checks and builds to `dist/`.
- `npm run typecheck` runs only `tsc`.
- `npm run gen:types` regenerates `src/contracts/types.ts` from the ABIs in `src/contracts/abi`.

## Local accounts

With `VITE_DEV_WALLETS=true` on a Hardhat node, the connect panel offers the default mnemonic's
accounts: 0 is admin, 1 and 2 are teachers, 3 is the vendor, 4 to 11 are students. These keys
are public. Never use them anywhere else.

## Layout

- `src/styles/tokens.css` holds every colour, size and duration. Pages use tokens, not raw values.
- `src/ui` holds the primitives, exported from `@/ui`.
- `src/lib` holds wallet, roles, contracts, api, eip712, format, tx and hooks.
- `src/shell` holds the app frame, role gate and wallet controls.
- `src/pages/<role>` holds each role's pages.

## Adding pages for a role

Each role owns two files:

- `src/pages/<role>/index.tsx` exports `<Role>Routes`, which is also the default export. It renders
  nested `<Routes>` with relative paths, so `path="sessions/:id"` serves `/<role>/sessions/:id`.
- `src/pages/<role>/nav.ts` exports `<role>Nav`, the sub-navigation items (`{ to, label, icon?, end? }`).

`App.tsx` lazy-loads the module behind `RequireRole`, so the pages never render without a
connected wallet on the right chain that holds the role.
