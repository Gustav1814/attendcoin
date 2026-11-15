require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const { SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY, ETHERSCAN_API_KEY, LOCAL_RPC_URL, CHAIN_START_DAYS_AGO } = process.env;

// Starting the node in the past gives scripts/seed.js room to lay out a term of
// sessions with realistic dates before it catches the chain up to the wall clock.
const initialDate = CHAIN_START_DAYS_AGO
  ? new Date(Date.now() - Number(CHAIN_START_DAYS_AGO) * 86_400_000).toISOString()
  : undefined;

module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
      viaIR: false,
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
      // Without this, quick bursts of transactions push block time ahead of the
      // wall clock, and live check-ins (timestamped by the phone) fall outside the window.
      allowBlocksWithSameTimestamp: true,
      ...(initialDate ? { initialDate } : {}),
    },
    localhost: { url: LOCAL_RPC_URL || "http://127.0.0.1:8545", chainId: 31337 },
    ...(SEPOLIA_RPC_URL && DEPLOYER_PRIVATE_KEY
      ? { sepolia: { url: SEPOLIA_RPC_URL, accounts: [DEPLOYER_PRIVATE_KEY], chainId: 11155111 } }
      : {}),
  },
  etherscan: { apiKey: ETHERSCAN_API_KEY || "" },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
    outputFile: process.env.REPORT_GAS_FILE,
    noColors: !!process.env.REPORT_GAS_FILE,
  },
};
