import { chain, chainName } from "@/lib/contracts";
import { useWallet } from "@/lib/wallet";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";

export function WrongNetwork() {
  const { chainId, switchNetwork, kind, error } = useWallet();
  return (
    <EmptyState
      tone="danger"
      title={`Switch to ${chain.name}`}
      body={
        <>
          Your wallet is on {chainName(chainId)}. AttendCoin runs on {chain.name} (chain ID {chain.chainId}).
          {error && !error.rejected && <> {error.message}</>}
        </>
      }
      action={
        kind === "injected" ? (
          <Button onClick={() => void switchNetwork()}>Switch network</Button>
        ) : undefined
      }
    />
  );
}
