import { Check, Copy, ExternalLink } from "lucide-react";
import { explorerAddressUrl } from "@/lib/contracts";
import { shortAddress } from "@/lib/format";
import { useCopy } from "@/lib/hooks";
import { cx } from "./cx";
import styles from "./AddressChip.module.css";

export interface AddressChipProps {
  address: string;
  /** Human name shown before the address, e.g. a profile name. */
  name?: string | null;
  chars?: number;
  /** Show an explorer link when the network has one. */
  explorer?: boolean;
  className?: string;
}

export function AddressChip({ address, name, chars = 4, explorer = false, className }: AddressChipProps) {
  const [copied, copy] = useCopy();
  const url = explorer ? explorerAddressUrl(address) : null;
  return (
    <span className={cx(styles.chip, className)}>
      {name && <span className={styles.name}>{name}</span>}
      <button
        type="button"
        className={styles.copy}
        onClick={() => void copy(address)}
        aria-label={copied ? "Address copied" : `Copy address ${address}`}
        title={address}
      >
        <span className="t-mono">{shortAddress(address, chars)}</span>
        {copied ? <Check size={13} className={styles.ok} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
      </button>
      {url && (
        <a className={styles.link} href={url} target="_blank" rel="noreferrer" aria-label="View address on block explorer">
          <ExternalLink size={13} aria-hidden="true" />
        </a>
      )}
      <span className="visually-hidden" aria-live="polite">
        {copied ? "Copied" : ""}
      </span>
    </span>
  );
}
