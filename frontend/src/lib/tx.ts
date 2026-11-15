import { useQueryClient } from "@tanstack/react-query";
import type { ContractTransactionResponse, Signer, TransactionResponse } from "ethers";
import { useCallback, useRef, useState } from "react";
import { useToast } from "@/ui/Toast";
import { explorerTxUrl, type Contracts } from "./contracts";
import { describeError, type FriendlyError } from "./errors";
import { useContracts, useWallet } from "./wallet";

export type TxPhase = "idle" | "signing" | "pending" | "confirmed" | "failed";

export interface TxState {
  phase: TxPhase;
  label: string;
  hash?: string;
  blockNumber?: number;
  error?: FriendlyError;
}

export interface TxContext {
  contracts: Contracts;
  signer: Signer;
  address: string;
}

export interface RunOptions<T> {
  /** Short noun phrase for toasts, e.g. "Redeem Lab coffee". */
  label: string;
  send: (ctx: TxContext) => Promise<ContractTransactionResponse | TransactionResponse>;
  /** Runs after one confirmation; its return value is passed back from `run`. */
  onConfirmed?: (receipt: { hash: string; blockNumber: number }) => T | Promise<T>;
  /** Skip the success toast when the page shows its own confirmation. */
  quiet?: boolean;
}

export interface UseTx {
  state: TxState;
  busy: boolean;
  run<T = void>(options: RunOptions<T>): Promise<T | undefined>;
  reset(): void;
}

const IDLE: TxState = { phase: "idle", label: "" };

/**
 * Sends one transaction and tracks it through signing, mining and confirmation.
 * Every chain query (keys starting with "chain") is invalidated on success.
 */
export function useTx(): UseTx {
  const { signer, address } = useWallet();
  const { write } = useContracts();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [state, setState] = useState<TxState>(IDLE);
  const busyRef = useRef(false);

  const run = useCallback(
    async <T>({ label, send, onConfirmed, quiet }: RunOptions<T>): Promise<T | undefined> => {
      if (busyRef.current) return undefined;
      if (!signer || !write || !address) {
        const error: FriendlyError = {
          title: "Wallet not ready",
          message: "Connect a wallet on the right network first.",
          rejected: false,
        };
        setState({ phase: "failed", label, error });
        return undefined;
      }
      busyRef.current = true;
      setState({ phase: "signing", label });
      try {
        const tx = await send({ contracts: write, signer, address });
        setState({ phase: "pending", label, hash: tx.hash });
        const receipt = await tx.wait(1);
        if (!receipt || receipt.status === 0) throw new Error("The transaction was mined but reverted.");
        setState({ phase: "confirmed", label, hash: tx.hash, blockNumber: receipt.blockNumber });
        await queryClient.invalidateQueries({ queryKey: ["chain"] });
        if (!quiet) {
          const url = explorerTxUrl(tx.hash);
          toast.push({
            tone: "success",
            title: `${label} confirmed`,
            body: `Block ${receipt.blockNumber.toLocaleString("en-US")}`,
            action: url ? { label: "View on explorer", href: url } : undefined,
          });
        }
        return onConfirmed ? await onConfirmed({ hash: tx.hash, blockNumber: receipt.blockNumber }) : undefined;
      } catch (err) {
        const error = describeError(err);
        setState((prev) => ({ phase: "failed", label, hash: prev.hash, error }));
        if (!error.rejected) toast.push({ tone: "danger", title: error.title, body: error.message });
        return undefined;
      } finally {
        busyRef.current = false;
      }
    },
    [signer, write, address, toast, queryClient],
  );

  return {
    state,
    busy: state.phase === "signing" || state.phase === "pending",
    run,
    reset: useCallback(() => setState(IDLE), []),
  };
}
