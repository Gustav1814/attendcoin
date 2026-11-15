import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256, toUtf8Bytes } from "ethers";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function loadDeployment(network) {
  const file = path.join(backendRoot, "src", `deployment.${network}.json`);
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(`No deployment for network "${network}". Run scripts/deploy.js first (expected ${file}).`);
    }
    throw err;
  }
  const deployment = JSON.parse(raw);
  if (!deployment.contracts?.AttendanceManager) {
    throw new Error(`${file} has no AttendanceManager address`);
  }
  return deployment;
}

// Hashing the configured salt gives a fixed-width bytes32 regardless of how
// long ID_SALT is. scripts/seed.js must derive it the same way.
export function saltFromSecret(secret) {
  return keccak256(toUtf8Bytes(secret));
}

export function loadConfig(env = process.env) {
  const port = Number(env.PORT ?? 4000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${env.PORT}`);
  }
  const network = env.NETWORK || "localhost";
  const idSalt = env.ID_SALT || "attendcoin-dev-salt";

  return {
    port,
    rpcUrl: env.RPC_URL || "http://127.0.0.1:8545",
    network,
    salt: saltFromSecret(idSalt),
    frontendOrigins: (env.FRONTEND_ORIGIN || "http://localhost:5173,http://127.0.0.1:5173")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    dataDir: path.resolve(backendRoot, env.DATA_DIR || "./data"),
    deployment: loadDeployment(network),
  };
}
