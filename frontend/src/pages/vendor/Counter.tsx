import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, ScanLine } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import {
  logsFromBlock,
  readItem,
  readRedemption,
  RedemptionStatus,
  type ItemView,
  type RedemptionView,
} from "@/lib/contracts";
import { parseRedemptionQr } from "@/lib/eip712";
import { describeError } from "@/lib/errors";
import { formatAtc, formatDateTime, formatRelative, formatTime, pluralize } from "@/lib/format";
import { useRoles } from "@/lib/roles";
import { useTx } from "@/lib/tx";
import { useChainKey, useContracts, useWallet } from "@/lib/wallet";
import { AddressChip } from "@/ui/AddressChip";
import { Badge } from "@/ui/Badge";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { Field, Input } from "@/ui/Field";
import { Page, PageHeader } from "@/ui/Page";
import { Panel } from "@/ui/Panel";
import { Scanner } from "@/ui/Scanner";
import { Skeleton } from "@/ui/Skeleton";
import { Stat, StatGroup } from "@/ui/Stat";
import { TxStatus } from "@/ui/TxStatus";
import { cx } from "@/ui/cx";
import styles from "./Counter.module.css";

const RECENT_LIMIT = 12;

interface Lookup {
  redemption: RedemptionView;
  item: ItemView;
  name: string | null;
}

function useRedemption(id: bigint | null) {
  const { read } = useContracts();
  const key = useChainKey();
  return useQuery({
    queryKey: [...key, "vendor", "redemption", id?.toString() ?? ""],
    enabled: Boolean(read && id),
    // A pending redemption can be cancelled by the student at any moment.
    refetchInterval: (q) => (q.state.data?.redemption.status === RedemptionStatus.Pending ? 5_000 : false),
    queryFn: async (): Promise<Lookup | null> => {
      const store = read!.store;
      const count = await store.redemptionCount();
      if (!id || id > count) return null;
      const redemption = await readRedemption(store, id);
      if (redemption.status === RedemptionStatus.None) return null;
      const [item, profile] = await Promise.all([
        readItem(store, redemption.itemId),
        api.profile(redemption.student).catch(() => null),
      ]);
      return { redemption, item, name: profile?.name ?? null };
    },
  });
}

interface Recent {
  redemption: RedemptionView;
  itemName: string;
  name: string | null;
}

function useRecentFulfilments() {
  const { read } = useContracts();
  const { address, provider } = useWallet();
  const key = useChainKey();
  return useQuery({
    queryKey: [...key, "vendor", "fulfilled"],
    enabled: Boolean(read && address && provider),
    refetchInterval: 30_000,
    queryFn: async (): Promise<Recent[]> => {
      const store = read!.store;
      const from = await logsFromBlock(provider!);
      const logs = await store.queryFilter(store.filters.Fulfilled(undefined, address!), from);
      const ids = [...new Set(logs.map((l) => l.topics[1]))]
        .map((t) => BigInt(t))
        .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
        .slice(0, RECENT_LIMIT);
      const redemptions = await Promise.all(ids.map((id) => readRedemption(store, id)));
      const itemIds = [...new Set(redemptions.map((r) => r.itemId.toString()))];
      const items = new Map(
        await Promise.all(itemIds.map(async (i) => [i, (await readItem(store, BigInt(i))).name] as const)),
      );
      const profiles = await api.profiles([...new Set(redemptions.map((r) => r.student))]).catch(() => []);
      const names = new Map(profiles.map((p) => [p.wallet.toLowerCase(), p.name]));
      return redemptions
        .map((r) => ({
          redemption: r,
          itemName: items.get(r.itemId.toString()) ?? `Item #${r.itemId}`,
          name: names.get(r.student.toLowerCase()) ?? null,
        }))
        .sort((a, b) => b.redemption.settledAt - a.redemption.settledAt);
    },
  });
}

function useTokenPaused() {
  const { read } = useContracts();
  const key = useChainKey();
  return useQuery({
    queryKey: [...key, "vendor", "token-paused"],
    enabled: Boolean(read),
    refetchInterval: 30_000,
    queryFn: () => read!.token.paused(),
  });
}

export function VendorCounter() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("r");
  const id = raw && /^\d+$/.test(raw) && raw !== "0" ? BigInt(raw) : null;
  const [scanKey, setScanKey] = useState(0);
  const roles = useRoles();
  const paused = useTokenPaused();

  const open = (next: bigint) => setParams({ r: next.toString() });
  const clear = () => {
    setParams({});
    setScanKey((k) => k + 1);
  };

  return (
    <Page>
      <PageHeader eyebrow="Vendor" title="Counter" description="Scan the code on the student's screen, check the item, then fulfil." />

      {roles.ready && !roles.has.vendor && (
        <p className={cx(styles.banner, styles.danger)} role="alert">
          This wallet isn't a vendor, so fulfilling will fail. Ask an admin to add it under People, Vendors.
        </p>
      )}
      {paused.data && (
        <p className={cx(styles.banner, styles.danger)} role="alert">
          AttendCoin is paused, so redemptions can't be settled right now. Don't hand anything over until an admin
          resumes it.
        </p>
      )}

      <div className={styles.layout}>
        <section className={styles.main} aria-label="Redemption">
          {id ? (
            <RedemptionPanel key={id.toString()} id={id} tokenPaused={Boolean(paused.data)} onNext={clear} />
          ) : (
            <LookupPanel key={scanKey} onFound={open} />
          )}
        </section>
        <aside className={styles.side} aria-label="Your fulfilments">
          <RecentPanel activeId={id} onOpen={open} />
        </aside>
      </div>
    </Page>
  );
}

function LookupPanel({ onFound }: { onFound: (id: bigint) => void }) {
  const [hint, setHint] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);

  const submit = () => {
    const parsed = parseRedemptionQr(manual.trim());
    if (parsed == null || parsed === 0n) {
      setManualError("Enter the number shown under the student's code, e.g. 42.");
      return;
    }
    onFound(parsed);
  };

  return (
    <Panel className={styles.lookup}>
      <Scanner
        label="Redemption code scanner"
        hint={hint ?? "Point the camera at the code on the student's Redemptions page."}
        onResult={(text) => {
          const parsed = parseRedemptionQr(text);
          if (parsed == null || parsed === 0n) {
            setHint("That isn't a redemption code. Ask the student to open the item under Redemptions.");
            return false;
          }
          onFound(parsed);
          return true;
        }}
      />
      <form
        className={styles.manual}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Or type the redemption number" error={manualError}>
          <Input
            inputMode="numeric"
            prefix="#"
            value={manual}
            onChange={(e) => {
              setManual(e.target.value);
              setManualError(null);
            }}
            autoComplete="off"
            className="t-num"
          />
        </Field>
        <Button type="submit" variant="secondary" size="lg" disabled={!manual.trim()}>
          Look up
        </Button>
      </form>
    </Panel>
  );
}

function RedemptionPanel({ id, tokenPaused, onNext }: { id: bigint; tokenPaused: boolean; onNext: () => void }) {
  const lookup = useRedemption(id);
  const tx = useTx();
  const data = lookup.data;
  const justFulfilled = tx.state.phase === "confirmed";

  const back = (
    <Button variant="ghost" size="sm" leading={<ArrowLeft size={14} />} onClick={onNext}>
      Scan another
    </Button>
  );

  if (lookup.isLoading) {
    return (
      <Panel className={styles.card} aria-busy="true">
        <span className="visually-hidden" role="status">
          Looking up redemption {id.toString()}
        </span>
        <Skeleton width={120} height={12} />
        <Skeleton width="70%" height={36} />
        <Skeleton width="40%" height={20} />
        <Skeleton width="100%" height={56} radius="var(--radius-md)" />
      </Panel>
    );
  }

  if (lookup.error) {
    return (
      <Panel className={styles.card}>
        <EmptyState
          tone="danger"
          title="Couldn't look that up"
          body={describeError(lookup.error).message}
          action={
            <>
              <Button variant="secondary" onClick={() => void lookup.refetch()}>
                Try again
              </Button>
              {back}
            </>
          }
        />
      </Panel>
    );
  }

  if (!data) {
    return (
      <Panel className={styles.card}>
        <EmptyState
          tone="danger"
          title={`No redemption #${id}`}
          body="Check the number under the student's code. It may have been typed or scanned from another app."
          action={
            <Button variant="primary" leading={<ScanLine size={16} />} onClick={onNext}>
              Scan again
            </Button>
          }
        />
      </Panel>
    );
  }

  const { redemption: r, item, name } = data;
  const status = justFulfilled ? RedemptionStatus.Fulfilled : r.status;

  const fulfil = () =>
    void tx.run({
      label: `Fulfil ${item.name}`,
      quiet: true,
      send: ({ contracts }) => contracts.store.fulfill(r.id),
    });

  return (
    <Panel className={cx(styles.card, justFulfilled && styles.handOver)}>
      <div className={styles.cardHead}>
        <span className={cx(styles.number, "t-num")}>#{r.id.toString()}</span>
        <StatusBadge status={status} />
      </div>

      <div className={styles.what}>
        <h2 className={styles.itemName}>{item.name}</h2>
        <p className={styles.price}>
          <span className="t-mark t-num">{formatAtc(r.price)}</span> <span className="t-muted">ATC</span>
        </p>
      </div>

      <dl className={styles.facts}>
        <div>
          <dt>Student</dt>
          <dd>
            <span className={styles.studentName}>{name ?? "Name not on file"}</span>
            <AddressChip address={r.student} />
          </dd>
        </div>
        <div>
          <dt>Redeemed</dt>
          <dd className="t-num" title={formatDateTime(r.createdAt)}>
            {formatRelative(r.createdAt)}
          </dd>
        </div>
      </dl>

      {justFulfilled ? (
        <div className={styles.outcome} role="status">
          <span className={styles.outcomeIcon} aria-hidden="true">
            <Check size={28} strokeWidth={1.5} />
          </span>
          <div>
            <p className={styles.outcomeTitle}>Hand over the {item.name}</p>
            <p className={styles.outcomeBody}>Confirmed on-chain. The ATC has been settled.</p>
          </div>
        </div>
      ) : status === RedemptionStatus.Fulfilled ? (
        <p className={styles.outcomeWarn} role="alert">
          <strong>Already handed over</strong> {r.settledAt ? formatRelative(r.settledAt) : ""}. Don't give it out again.
        </p>
      ) : status === RedemptionStatus.Cancelled ? (
        <p className={styles.outcomeWarn} role="alert">
          <strong>Cancelled by the student</strong>, who got their ATC back. Don't hand anything over.
        </p>
      ) : (
        <div className={styles.act}>
          <Button
            variant="primary"
            size="lg"
            full
            loading={tx.busy}
            disabled={tokenPaused}
            onClick={fulfil}
          >
            {tx.state.phase === "failed" ? "Try again" : `Fulfil #${r.id}`}
          </Button>
          <p className={styles.actNote}>Hand the item over only once this confirms.</p>
        </div>
      )}

      <TxStatus state={tx.state} />

      <div className={styles.cardFoot}>
        {justFulfilled || status !== RedemptionStatus.Pending ? (
          <Button variant={justFulfilled ? "primary" : "secondary"} size="lg" full leading={<ScanLine size={18} />} onClick={onNext}>
            Scan next
          </Button>
        ) : (
          !tx.busy && back
        )}
      </div>
    </Panel>
  );
}

function StatusBadge({ status }: { status: RedemptionStatus }) {
  if (status === RedemptionStatus.Pending)
    return (
      <Badge tone="mark" dot>
        Waiting
      </Badge>
    );
  if (status === RedemptionStatus.Fulfilled)
    return (
      <Badge tone="ink" dot>
        Fulfilled
      </Badge>
    );
  return (
    <Badge tone="pen" dot>
      Cancelled
    </Badge>
  );
}

function RecentPanel({ activeId, onOpen }: { activeId: bigint | null; onOpen: (id: bigint) => void }) {
  const recent = useRecentFulfilments();
  const startOfDay = new Date().setHours(0, 0, 0, 0) / 1000;
  const today = recent.data?.filter((f) => f.redemption.settledAt >= startOfDay) ?? [];
  const value = today.reduce((sum, f) => sum + f.redemption.price, 0n);

  return (
    <Panel title="Today" flush>
      <StatGroup className={styles.today}>
        <Stat label="Handed over" loading={recent.isLoading} value={recent.data ? today.length : null} />
        <Stat
          label="Settled"
          unit="ATC"
          loading={recent.isLoading}
          value={recent.data ? formatAtc(value) : null}
          tone="mark"
        />
      </StatGroup>
      <h3 className={styles.recentTitle}>Your recent fulfilments</h3>
      {recent.error ? (
        <EmptyState
          compact
          tone="danger"
          className={styles.inset}
          title="Couldn't load your history"
          body="The node refused the event query."
          action={
            <Button size="sm" variant="secondary" onClick={() => void recent.refetch()}>
              Try again
            </Button>
          }
        />
      ) : !recent.data ? (
        <ul className={styles.recent} aria-busy="true" aria-label="Loading">
          {Array.from({ length: 4 }, (_, i) => (
            <li key={i} className={styles.recentRow}>
              <Skeleton width="60%" />
              <Skeleton width={48} />
            </li>
          ))}
        </ul>
      ) : recent.data.length === 0 ? (
        <EmptyState
          compact
          className={styles.inset}
          title="Nothing handed over yet"
          body="Fulfilled redemptions from this wallet show up here."
        />
      ) : (
        <ul className={styles.recent}>
          {recent.data.map(({ redemption: r, itemName, name }) => (
            <li key={r.id.toString()}>
              <button
                type="button"
                className={cx(styles.recentRow, styles.recentButton, activeId === r.id && styles.recentActive)}
                onClick={() => onOpen(r.id)}
              >
                <span className={styles.recentWhat}>
                  <span className={styles.recentItem}>{itemName}</span>
                  <span className={styles.recentWho}>
                    {name ?? "Unknown student"} · <span className="t-num">#{r.id.toString()}</span>
                  </span>
                </span>
                <span className={styles.recentMeta}>
                  <span className="t-mark t-num">{formatAtc(r.price)}</span>
                  <time className="t-num" dateTime={new Date(r.settledAt * 1000).toISOString()}>
                    {r.settledAt >= startOfDay ? formatTime(r.settledAt) : formatRelative(r.settledAt)}
                  </time>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {recent.data && recent.data.length > 0 && (
        <p className={styles.recentFoot}>
          Your last {pluralize(recent.data.length, "fulfilment")}.
        </p>
      )}
    </Panel>
  );
}
