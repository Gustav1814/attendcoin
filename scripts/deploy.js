// Deploys AttendCoin, AttendanceManager and RewardStore, wires up roles,
// and writes addresses to deployments/<network>.json and the frontend/backend.
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const SUPPLY_CAP = hre.ethers.parseEther("10000000");

async function main() {
  const { ethers, network } = hre;
  const [deployer] = await ethers.getSigners();
  const admin = process.env.ADMIN_ADDRESS || deployer.address;
  const treasury = process.env.TREASURY_ADDRESS || admin;

  console.log(`Network: ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);

  const token = await ethers.deployContract("AttendCoin", [deployer.address, SUPPLY_CAP]);
  await token.waitForDeployment();
  // Log scans start here instead of genesis, which public RPCs refuse on Sepolia.
  const deployBlock = (await token.deploymentTransaction().wait()).blockNumber;

  const manager = await ethers.deployContract("AttendanceManager", [deployer.address, await token.getAddress()]);
  await manager.waitForDeployment();

  const store = await ethers.deployContract("RewardStore", [
    deployer.address,
    await token.getAddress(),
    await manager.getAddress(),
    treasury,
  ]);
  await store.waitForDeployment();

  const managerAddr = await manager.getAddress();
  const storeAddr = await store.getAddress();

  // The manager mints rewards, allowlists student wallets and handles re-links.
  await (await token.grantRole(await token.MINTER_ROLE(), managerAddr)).wait();
  await (await token.grantRole(await token.REGISTRAR_ROLE(), managerAddr)).wait();
  await (await token.grantRole(await token.RECOVERY_ROLE(), managerAddr)).wait();

  // The store holds escrow and the treasury receives settled tokens.
  await (await token.setAllowed(storeAddr, true)).wait();
  await (await token.setAllowed(treasury, true)).wait();

  // Hand admin rights over if a separate admin was configured.
  if (admin.toLowerCase() !== deployer.address.toLowerCase()) {
    for (const c of [token, manager, store]) {
      await (await c.grantRole(await c.DEFAULT_ADMIN_ROLE(), admin)).wait();
    }
    console.log(`Granted DEFAULT_ADMIN_ROLE to ${admin}. Revoke the deployer manually once confirmed.`);
  }

  const deployment = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployedAt: new Date().toISOString(),
    deployBlock,
    admin,
    treasury,
    contracts: {
      AttendCoin: await token.getAddress(),
      AttendanceManager: managerAddr,
      RewardStore: storeAddr,
    },
  };

  // DEPLOYMENT_FILE writes a single file instead, so a throwaway node does not
  // overwrite the addresses the frontend and backend are using.
  const root = path.join(__dirname, "..");
  const outputs = process.env.DEPLOYMENT_FILE
    ? [path.resolve(process.env.DEPLOYMENT_FILE)]
    : [
        path.join(root, "deployments", `${network.name}.json`),
        path.join(root, "frontend", "src", "contracts", `deployment.${network.name}.json`),
        path.join(root, "backend", "src", `deployment.${network.name}.json`),
      ];
  for (const file of outputs) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(deployment, null, 2) + "\n");
  }

  console.table(deployment.contracts);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
