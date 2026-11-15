import {
  BrowserProvider,
  HDNodeWallet,
  Wallet,
  getAddress,
  toBeHex,
  type JsonRpcSigner,
  type Provider,
  type Signer,
} from "ethers";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { chain, deployment, getContracts, getFallbackProvider, type Contracts } from "./contracts";
import { describeError, type FriendlyError } from "./errors";

export type WalletKind = "injected" | "dev";
export type WalletStatus = "idle" | "connecting" | "connected";

export type DevRole = "Admin" | "Teacher" | "Vendor" | "Student";

export interface DevAccount {
  index: number;
  address: string;
  role: DevRole;
  label: string;
}

export interface WalletContextValue {
  status: WalletStatus;
  kind: WalletKind | null;
  address: string | null;
  /** Chain the wallet is on. For dev accounts this is always the local chain. */
  chainId: number | null;
  /** Signer for transactions and signatures, or null when not connected or on the wrong chain. */
  signer: Signer | null;
  /** Read provider for the configured chain; works before a wallet is connected when an RPC is known. */
  provider: Provider | null;
  isCorrectChain: boolean;
  hasInjected: boolean;
  devWalletsEnabled: boolean;
  devAccounts: DevAccount[];
  error: FriendlyError | null;
  connectInjected(): Promise<void>;
  connectDev(index: number): Promise<void>;
  disconnect(): void;
  switchNetwork(): Promise<void>;
  clearError(): void;
}

const HARDHAT_MNEMONIC = "test test test test test test test test test test test junk";
const STORAGE_KEY = "attendcoin.wallet";

export const devWalletsEnabled = import.meta.env.VITE_DEV_WALLETS === "true" && chain.chainId === 31337;

function devRole(index: number): DevRole {
  if (index === 0) return "Admin";
  if (index === 1 || index === 2) return "Teacher";
  if (index === 3) return "Vendor";
  return "Student";
}

function devLabel(index: number): string {
  if (index === 0) return "Admin and treasury";
  if (index <= 2) return `Teacher ${index}`;
  if (index === 3) return "Vendor";
  return `Student ${index - 3}`;
}

let devRoot: HDNodeWallet | null = null;

function deriveDevWallet(index: number): HDNodeWallet {
  devRoot ??= HDNodeWallet.fromPhrase(HARDHAT_MNEMONIC, "", "m/44'/60'/0'/0");
  return devRoot.deriveChild(index);
}

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(value: string | null): void {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, value);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage can be unavailable in private windows; the session still works
  }
}

const WalletContext = createContext<WalletContextValue | null>(null);

interface Connection {
  kind: WalletKind;
  address: string;
  chainId: number;
  signer: Signer;
  browserProvider?: BrowserProvider;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [conn, setConn] = useState<Connection | null>(null);
  const [status, setStatus] = useState<WalletStatus>("idle");
  const [error, setError] = useState<FriendlyError | null>(null);
  const [devAccounts, setDevAccounts] = useState<DevAccount[]>([]);
  const ethereum = typeof window !== "undefined" ? window.ethereum : undefined;
  const connRef = useRef(conn);
  connRef.current = conn;

  useEffect(() => {
    if (!devWalletsEnabled) return;
    // Deriving twelve keys takes a moment; keep it off the first paint.
    const id = window.setTimeout(() => {
      setDevAccounts(
        Array.from({ length: 12 }, (_, index) => ({
          index,
          address: deriveDevWallet(index).address,
          role: devRole(index),
          label: devLabel(index),
        })),
      );
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  const attachInjected = useCallback(
    async (requestAccess: boolean) => {
      if (!ethereum) throw new Error("No browser wallet found. Install MetaMask, or use a local test account.");
      const accounts = (await ethereum.request({
        method: requestAccess ? "eth_requestAccounts" : "eth_accounts",
      })) as string[];
      if (!accounts.length) return false;
      const browserProvider = new BrowserProvider(ethereum, "any");
      const chainHex = (await ethereum.request({ method: "eth_chainId" })) as string;
      const address = getAddress(accounts[0]);
      const signer: JsonRpcSigner = await browserProvider.getSigner(address);
      setConn({ kind: "injected", address, chainId: Number(chainHex), signer, browserProvider });
      writeStored("injected");
      return true;
    },
    [ethereum],
  );

  const attachDev = useCallback(async (index: number) => {
    if (!devWalletsEnabled) throw new Error("Local test accounts are off for this network.");
    const provider = getFallbackProvider();
    if (!provider) throw new Error("No local RPC configured.");
    const remoteChain = Number(await provider.send("eth_chainId", []));
    if (remoteChain !== 31337) throw new Error("The RPC isn't a local Hardhat node, so test accounts are disabled.");
    const hd = deriveDevWallet(index);
    const signer = new Wallet(hd.privateKey, provider);
    setConn({ kind: "dev", address: hd.address, chainId: remoteChain, signer });
    writeStored(`dev:${index}`);
  }, []);

  useEffect(() => {
    const stored = readStored();
    if (!stored) return;
    setStatus("connecting");
    const restore = stored.startsWith("dev:")
      ? attachDev(Number(stored.slice(4))).then(() => true)
      : attachInjected(false);
    restore
      .then((ok) => {
        if (!ok) writeStored(null);
      })
      .catch(() => writeStored(null))
      .finally(() => setStatus("idle"));
  }, [attachDev, attachInjected]);

  useEffect(() => {
    if (!ethereum?.on) return;
    const onAccounts = (accounts: string[]) => {
      if (connRef.current?.kind !== "injected") return;
      if (!accounts.length) {
        setConn(null);
        writeStored(null);
        return;
      }
      void attachInjected(false).catch(() => setConn(null));
    };
    const onChain = () => {
      if (connRef.current?.kind !== "injected") return;
      void attachInjected(false).catch(() => setConn(null));
    };
    ethereum.on("accountsChanged", onAccounts);
    ethereum.on("chainChanged", onChain);
    return () => {
      ethereum.removeListener?.("accountsChanged", onAccounts);
      ethereum.removeListener?.("chainChanged", onChain);
    };
  }, [ethereum, attachInjected]);

  const connectInjected = useCallback(async () => {
    setError(null);
    setStatus("connecting");
    try {
      await attachInjected(true);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setStatus("idle");
    }
  }, [attachInjected]);

  const connectDev = useCallback(
    async (index: number) => {
      setError(null);
      setStatus("connecting");
      try {
        await attachDev(index);
      } catch (err) {
        setError(describeError(err));
      } finally {
        setStatus("idle");
      }
    },
    [attachDev],
  );

  const disconnect = useCallback(() => {
    setConn(null);
    setError(null);
    writeStored(null);
  }, []);

  const switchNetwork = useCallback(async () => {
    if (!ethereum) return;
    setError(null);
    const chainIdHex = toBeHex(chain.chainId);
    try {
      await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] });
    } catch (err) {
      const code = (err as { code?: number })?.code ?? (err as { data?: { originalError?: { code?: number } } })?.data?.originalError?.code;
      if (code === 4902 && chain.rpcUrl) {
        try {
          await ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: chainIdHex,
                chainName: chain.name,
                rpcUrls: [chain.rpcUrl],
                nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
                ...(chain.explorer ? { blockExplorerUrls: [chain.explorer] } : {}),
              },
            ],
          });
        } catch (addErr) {
          setError(describeError(addErr));
        }
      } else {
        setError(describeError(err));
      }
    }
  }, [ethereum]);

  const value = useMemo<WalletContextValue>(() => {
    const isCorrectChain = conn ? conn.chainId === chain.chainId : false;
    const provider =
      conn?.kind === "injected" && isCorrectChain && conn.browserProvider
        ? conn.browserProvider
        : getFallbackProvider();
    return {
      status: conn ? "connected" : status,
      kind: conn?.kind ?? null,
      address: conn?.address ?? null,
      chainId: conn?.chainId ?? null,
      signer: conn && isCorrectChain ? conn.signer : null,
      provider,
      isCorrectChain,
      hasInjected: Boolean(ethereum),
      devWalletsEnabled,
      devAccounts,
      error,
      connectInjected,
      connectDev,
      disconnect,
      switchNetwork,
      clearError: () => setError(null),
    };
  }, [conn, status, ethereum, devAccounts, error, connectInjected, connectDev, disconnect, switchNetwork]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}

export interface ContractsHandle {
  /** Bound to the read provider. Null when contracts aren't deployed or no RPC is reachable. */
  read: Contracts | null;
  /** Bound to the signer. Null until a wallet is connected on the correct chain. */
  write: Contracts | null;
  deployed: boolean;
}

export function useContracts(): ContractsHandle {
  const { provider, signer } = useWallet();
  return useMemo(() => {
    if (!deployment) return { read: null, write: null, deployed: false };
    return {
      read: provider ? getContracts(provider) : null,
      write: signer ? getContracts(signer) : null,
      deployed: true,
    };
  }, [provider, signer]);
}

/** Stable scope for react-query keys so cached chain reads never leak across accounts or chains. */
export function useChainKey(): readonly [string, number, string] {
  const { address } = useWallet();
  return ["chain", chain.chainId, address?.toLowerCase() ?? "anon"] as const;
}
