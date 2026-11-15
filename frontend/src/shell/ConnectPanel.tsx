import { Wallet } from "lucide-react";
import type { DevRole } from "@/lib/wallet";
import { useWallet } from "@/lib/wallet";
import { shortAddress } from "@/lib/format";
import { Button } from "@/ui/Button";
import { Spinner } from "@/ui/Spinner";
import { cx } from "@/ui/cx";
import styles from "./ConnectPanel.module.css";

const GROUPS: DevRole[] = ["Student", "Teacher", "Vendor", "Admin"];

interface ConnectPanelProps {
  /** Called after a connection attempt succeeds, e.g. to close a dialog. */
  onConnected?: () => void;
  className?: string;
}

/** Wallet choices: the browser wallet, plus Hardhat accounts on a local dev chain. */
export function ConnectPanel({ onConnected, className }: ConnectPanelProps) {
  const wallet = useWallet();
  const connecting = wallet.status === "connecting";

  const connectInjected = async () => {
    await wallet.connectInjected();
    onConnected?.();
  };

  const connectDev = async (index: number) => {
    await wallet.connectDev(index);
    onConnected?.();
  };

  return (
    <div className={cx(styles.panel, className)}>
      <div className={styles.primary}>
        {wallet.hasInjected ? (
          <Button size="lg" full leading={<Wallet size={18} aria-hidden="true" />} loading={connecting} onClick={connectInjected}>
            Connect MetaMask
          </Button>
        ) : (
          <>
            <Button size="lg" full variant="secondary" href="https://metamask.io/download/">
              Install MetaMask
            </Button>
            <p className={styles.note}>
              No browser wallet was found. On a phone, open this page in the MetaMask app&rsquo;s browser.
            </p>
          </>
        )}
      </div>

      {wallet.error && !wallet.error.rejected && (
        <p className={styles.error} role="alert">
          <strong>{wallet.error.title}.</strong> {wallet.error.message}
        </p>
      )}

      {wallet.devWalletsEnabled && (
        <div className={styles.dev}>
          <div className={styles.devHead}>
            <p className="t-caps">Local test accounts</p>
            <p className={styles.note}>Hardhat accounts signed in the browser. Local chain only.</p>
          </div>
          {wallet.devAccounts.length === 0 ? (
            <Spinner label="Preparing test accounts" />
          ) : (
            GROUPS.map((group) => {
              const accounts = wallet.devAccounts.filter((a) => a.role === group);
              return (
                <div key={group} className={styles.group} role="group" aria-label={`${group} accounts`}>
                  <p className={styles.groupLabel}>{group}</p>
                  <ul className={styles.accounts}>
                    {accounts.map((a) => {
                      const active = wallet.address === a.address;
                      return (
                        <li key={a.index}>
                          <button
                            type="button"
                            className={cx(styles.account, active && styles.active)}
                            onClick={() => connectDev(a.index)}
                            disabled={connecting}
                            aria-current={active ? "true" : undefined}
                          >
                            <span className={styles.accountLabel}>{a.label}</span>
                            <span className="t-mono t-muted">{shortAddress(a.address)}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
