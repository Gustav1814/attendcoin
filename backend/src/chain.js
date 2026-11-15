import { Contract, JsonRpcProvider, verifyTypedData } from "ethers";
import attendanceManagerAbi from "./abi/AttendanceManager.json" with { type: "json" };

export const TICKET_TYPES = {
  Ticket: [
    { name: "sessionId", type: "uint256" },
    { name: "issuedAt", type: "uint64" },
  ],
};

export const CHECKIN_TYPES = {
  CheckIn: [
    { name: "sessionId", type: "uint256" },
    { name: "student", type: "address" },
    { name: "issuedAt", type: "uint64" },
    { name: "ticketHash", type: "bytes32" },
  ],
};

export function eip712Domain(chainId, attendanceManager) {
  return {
    name: "AttendCoin Attendance",
    version: "1",
    chainId: Number(chainId),
    verifyingContract: attendanceManager,
  };
}

export function createChain({ rpcUrl, deployment, provider }) {
  const chainId = Number(deployment.chainId);
  // staticNetwork stops ethers from re-detecting the network on every call
  // and from spinning in the background when the node is down.
  provider ??= new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
  const manager = new Contract(deployment.contracts.AttendanceManager, attendanceManagerAbi, provider);
  const domain = eip712Domain(chainId, deployment.contracts.AttendanceManager);

  function recoverTypedSigner(types, value, signature) {
    try {
      return verifyTypedData(domain, types, value, signature);
    } catch {
      return null;
    }
  }

  // The contract checks student signatures with plain ECDSA, so smart-contract
  // wallets are rejected here too rather than queued and refused on-chain.
  async function isValidCheckInSignature(value, signature) {
    const recovered = recoverTypedSigner(CHECKIN_TYPES, value, signature);
    return recovered?.toLowerCase() === value.student.toLowerCase();
  }

  async function verifyDeployment() {
    const [network, code] = await Promise.all([
      provider.send("eth_chainId", []),
      provider.getCode(deployment.contracts.AttendanceManager),
    ]);
    if (Number(network) !== chainId) {
      throw new Error(`RPC is on chain ${Number(network)} but the deployment is for chain ${chainId}`);
    }
    if (code === "0x") {
      throw new Error(`No AttendanceManager code at ${deployment.contracts.AttendanceManager}. Redeploy?`);
    }
  }

  return {
    provider,
    manager,
    chainId,
    domain,
    contracts: deployment.contracts,
    fromBlock: deployment.deployBlock ?? 0,
    recoverTicketSigner: (value, signature) => recoverTypedSigner(TICKET_TYPES, value, signature),
    isValidCheckInSignature,
    verifyDeployment,
  };
}
