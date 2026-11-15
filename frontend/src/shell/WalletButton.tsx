import { ChevronDown, LogOut, RefreshCw } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ROLE_LABEL, homePathFor, useRoles } from "@/lib/roles";
import { useWallet } from "@/lib/wallet";
import { shortAddress } from "@/lib/format";
import { AddressChip } from "@/ui/AddressChip";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { ConnectPanel } from "./ConnectPanel";
import styles from "./WalletButton.module.css";

export function WalletButton() {
  const wallet = useWallet();
  const { roles } = useRoles();
  const [connectOpen, setConnectOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const connectDialog = (
    <Dialog
      open={connectOpen}
      onClose={() => setConnectOpen(false)}
      title="Connect a wallet"
      description="Your wallet address is your AttendCoin account."
    >
      <ConnectPanel onConnected={() => setConnectOpen(false)} />
    </Dialog>
  );

  if (!wallet.address) {
    return (
      <>
        <Button size="sm" loading={wallet.status === "connecting"} onClick={() => setConnectOpen(true)}>
          Connect
        </Button>
        {connectDialog}
      </>
    );
  }

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-haspopup="true"
        aria-expanded={menuOpen}
        aria-controls={menuId}
        onClick={() => setMenuOpen((v) => !v)}
      >
        <span className={styles.dot} data-kind={wallet.kind} aria-hidden="true" />
        <span className="t-mono">{shortAddress(wallet.address)}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>

      {menuOpen && (
        <div className={styles.menu} id={menuId}>
          <div className={styles.menuHead}>
            <AddressChip address={wallet.address} explorer />
            <p className={styles.meta}>{wallet.kind === "dev" ? "Local test account" : "Browser wallet"}</p>
          </div>
          {roles.length > 0 && (
            <nav className={styles.roleLinks} aria-label="Switch role">
              {roles.map((r) => (
                <Link key={r} to={homePathFor(r)} className={styles.roleLink} onClick={() => setMenuOpen(false)}>
                  {ROLE_LABEL[r]}
                </Link>
              ))}
            </nav>
          )}
          <div className={styles.menuActions}>
            {(wallet.kind === "dev" || wallet.devWalletsEnabled) && (
              <Button
                variant="ghost"
                size="sm"
                full
                leading={<RefreshCw size={14} aria-hidden="true" />}
                onClick={() => {
                  setMenuOpen(false);
                  setConnectOpen(true);
                }}
              >
                Switch account
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              full
              leading={<LogOut size={14} aria-hidden="true" />}
              onClick={() => {
                setMenuOpen(false);
                wallet.disconnect();
              }}
            >
              Disconnect
            </Button>
          </div>
        </div>
      )}
      {connectDialog}
    </div>
  );
}
