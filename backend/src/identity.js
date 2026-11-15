import { solidityPackedKeccak256 } from "ethers";

// Same as keccak256(abi.encodePacked(bytes32 salt, string rollNumber)) in Solidity.
export function idHashFor(salt, rollNumber) {
  return solidityPackedKeccak256(["bytes32", "string"], [salt, rollNumber]);
}
