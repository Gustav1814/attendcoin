import { chain, chainName } from "@/lib/contracts";
import { useWallet } from "@/lib/wallet";
import { Badge } from "@/ui/Badge";

/** Which chain the app targets, and whether the connected wallet agrees. */
export function NetworkBadge({ className }: { className?: string }) {
  const { address, chainId, isCorrectChain } = useWallet();
  if (address && !isCorrectChain) {
    return (
      <Badge tone="pen" dot className={className} title={`Wallet is on ${chainName(chainId)}; the app uses ${chain.name}`}>
        Wrong network
      </Badge>
    );
  }
  return (
    <Badge tone={address ? "ink" : "neutral"} dot className={className} title={`Chain ID ${chain.chainId}`}>
      {chain.name}
    </Badge>
  );
}
