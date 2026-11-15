// Copies contract ABIs from Hardhat artifacts into the frontend and backend.
// Run after `npx hardhat compile`.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const contracts = ["AttendCoin", "AttendanceManager", "RewardStore"];
const targets = [
  path.join(root, "frontend", "src", "contracts", "abi"),
  path.join(root, "backend", "src", "abi"),
];

for (const dir of targets) fs.mkdirSync(dir, { recursive: true });

for (const name of contracts) {
  const artifact = path.join(root, "artifacts", "contracts", `${name}.sol`, `${name}.json`);
  const { abi } = JSON.parse(fs.readFileSync(artifact, "utf8"));
  for (const dir of targets) {
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(abi, null, 2) + "\n");
  }
}

console.log(`Exported ${contracts.length} ABIs to ${targets.length} locations`);
