import { useQuery } from "@tanstack/react-query";
import { QrCode as QrIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { RedemptionStatus, readItem, readRedemption, type RedemptionView } from "@/lib/contracts";
import { redemptionQrPayload } from "@/lib/eip712";
import { formatAtc, formatDateTime, formatRelative } from "@/lib/format";
import { useTx } from "@/lib/tx";
import { useChainKey, useContracts, useWallet } from "@/lib/wallet";
import { Badge, type BadgeTone } from "@/ui/Badge";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { EmptyState } from "@/ui/EmptyState";
import { Page, PageHeader } from "@/ui/Page";
import { Panel } from "@/ui/Panel";
import { QrCode } from "@/ui/QrCode";
import { Table, type Column } from "@/ui/Table";
import { Tabs } from "@/ui/Tabs";
import { TxStatus } from "@/ui/TxStatus";
import styles from "./Redemptions.module.css";

interface Row extends RedemptionView {
  itemName: string;
}

type Filter = "pending" | "fulfilled" | "cancelled" | "all";

const STATUS: Record<RedemptionStatus, { label: string; tone: BadgeTone }> = {
  [RedemptionStatus.None]: { label: "Unknown", tone: "neutral" },
  [RedemptionStatus.Pending]: { label: "Ready to collect", tone: "mark" },
  [RedemptionStatus.Fulfilled]: { label: "Collected", tone: "ink" },
  [RedemptionStatus.Cancelled]: { label: "Cancelled", tone: "neutral" },
};

const FILTER_STATUS: Record<Exclude<Filter, "all">, RedemptionStatus> = {
  pending: RedemptionStatus.Pending,
  fulfilled: RedemptionStatus.Fulfilled,
  cancelled: RedemptionStatus.Cancelled,
};

function useRedemptions() {
  const { read } = useContracts();
  const { address } = useWallet();
  const key = useChainKey();
  return useQuery({
    queryKey: [...key, "redemptions"],
    enabled: Boolean(read && address),
    // A vendor fulfils on their own device; keep the list in step while the student waits at the counter.
    refetchInterval: 10_000,
    queryFn: async (): Promise<Row[]> => {
      const { store } = read!;
      const ids = await store.getRedemptionsOf(address!);
      const redemptions = await Promise.all(ids.map((id) => readRedemption(store, id)));
      const itemIds = [...new Set(redemptions.map((r) => r.itemId.toString()))];
      const items = await Promise.all(itemIds.map((id) => readItem(store, BigInt(id))));
      const names = new Map(items.map((i) => [i.id.toString(), i.name]));
      return redemptions
        .map((r) => ({ ...r, itemName: names.get(r.itemId.toString()) ?? `Item ${r.itemId}` }))
        .sort((a, b) => (a.id < b.id ? 1 : -1));
    },
  });
}

export function Redemptions() {
  const redemptions = useRedemptions();
  const [filter, setFilter] = useState<Filter>("pending");
  const [showing, setShowing] = useState<Row | null>(null);
  const [cancelling, setCancelling] = useState<Row | null>(null);

  const all = redemptions.data;
  const counts = useMemo(() => {
    const c = { pending: 0, fulfilled: 0, cancelled: 0, all: all?.length ?? 0 };
    for (const r of all ?? []) {
      if (r.status === RedemptionStatus.Pending) c.pending++;
      else if (r.status === RedemptionStatus.Fulfilled) c.fulfilled++;
      else if (r.status === RedemptionStatus.Cancelled) c.cancelled++;
    }
    return c;
  }, [all]);
  const rows = all && (filter === "all" ? all : all.filter((r) => r.status === FILTER_STATUS[filter]));

  // Keep the open code in sync so it flips to "Collected" when the vendor scans it.
  const live = showing && all?.find((r) => r.id === showing.id);

  const columns: Column<Row>[] = [
    {
      key: "id",
      header: "No.",
      numeric: true,
      width: "1%",
      render: (r) => <span className="t-muted">#{r.id.toString()}</span>,
    },
    { key: "item", header: "Item", render: (r) => <span className={styles.item}>{r.itemName}</span> },
    {
      key: "price",
      header: "Paid (ATC)",
      align: "right",
      numeric: true,
      hideOnMobile: true,
      render: (r) => formatAtc(r.price),
    },
    {
      key: "created",
      header: "Redeemed",
      hideOnMobile: true,
      render: (r) => (
        <time dateTime={new Date(r.createdAt * 1000).toISOString()} title={formatDateTime(r.createdAt)}>
          {formatRelative(r.createdAt)}
        </time>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>,
    },
    {
      key: "actions",
      header: <span className="visually-hidden">Actions</span>,
      align: "right",
      width: "1%",
      render: (r) =>
        r.status === RedemptionStatus.Pending ? (
          <div className={styles.actions}>
            <Button size="sm" leading={<QrIcon size={14} aria-hidden="true" />} onClick={() => setShowing(r)}>
              Show code
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCancelling(r)} aria-label={`Cancel redemption ${r.id}`}>
              Cancel
            </Button>
          </div>
        ) : r.settledAt ? (
          <span className={styles.settled}>{formatRelative(r.settledAt)}</span>
        ) : null,
    },
  ];

  const emptyCopy: Record<Filter, { title: string; body: string }> = {
    pending: { title: "Nothing waiting to collect", body: "Rewards you redeem in the store appear here until the vendor hands them over." },
    fulfilled: { title: "Nothing collected yet", body: "Collected rewards are listed here." },
    cancelled: { title: "No cancelled redemptions", body: "If you cancel a redemption, the refund is recorded here." },
    all: { title: "No redemptions yet", body: "Spend ATC in the store and your redemptions will show up here." },
  };

  return (
    <Page>
      <PageHeader
        eyebrow="Student"
        title="Redemptions"
        actions={
          <Button variant="secondary" to="/student/store">
            Go to store
          </Button>
        }
      />
      <Panel flush>
        <Tabs
          className={styles.tabs}
          label="Filter redemptions"
          value={filter}
          onChange={setFilter}
          items={[
            { value: "pending", label: "To collect", count: counts.pending },
            { value: "fulfilled", label: "Collected", count: counts.fulfilled },
            { value: "cancelled", label: "Cancelled", count: counts.cancelled },
            { value: "all", label: "All", count: counts.all },
          ]}
        >
          {redemptions.error ? (
            <EmptyState
              tone="danger"
              compact
              title="Couldn't load your redemptions"
              body="The blockchain node didn't respond."
              action={
                <Button size="sm" variant="secondary" onClick={() => void redemptions.refetch()}>
                  Try again
                </Button>
              }
            />
          ) : (
            <Table
              label="Redemptions"
              columns={columns}
              rows={rows}
              loading={redemptions.isLoading}
              rowKey={(r) => r.id.toString()}
              empty={
                <EmptyState
                  compact
                  title={emptyCopy[filter].title}
                  body={emptyCopy[filter].body}
                  action={
                    filter === "pending" || filter === "all" ? (
                      <Button size="sm" variant="secondary" to="/student/store">
                        Browse the store
                      </Button>
                    ) : undefined
                  }
                />
              }
            />
          )}
        </Tabs>
      </Panel>

      {showing && <CodeDialog row={live ?? showing} onClose={() => setShowing(null)} />}
      {cancelling && <CancelDialog row={cancelling} onClose={() => setCancelling(null)} />}
    </Page>
  );
}

function CodeDialog({ row, onClose }: { row: Row; onClose: () => void }) {
  const collected = row.status === RedemptionStatus.Fulfilled;
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={row.itemName}
      description={collected ? undefined : "Show this code at the vendor's counter."}
      footer={
        <Button variant={collected ? "primary" : "secondary"} onClick={onClose} full>
          {collected ? "Done" : "Close"}
        </Button>
      }
    >
      <div className={styles.code}>
        {collected ? (
          <div className={styles.collected} role="status" aria-live="polite">
            <Badge tone="ink" dot>
              Collected
            </Badge>
            <p>The vendor has marked this as handed over.</p>
          </div>
        ) : (
          <QrCode value={redemptionQrPayload(row.id)} size={260} label={`Redemption code ${row.id}`} />
        )}
        <p className={styles.codeId}>
          <span className="t-caps t-muted">Redemption</span>
          <span className="t-num">#{row.id.toString()}</span>
        </p>
      </div>
    </Dialog>
  );
}

function CancelDialog({ row, onClose }: { row: Row; onClose: () => void }) {
  const tx = useTx();
  const busy = tx.busy;
  const done = tx.state.phase === "confirmed";
  return (
    <Dialog
      open
      onClose={() => !busy && onClose()}
      dismissible={!busy}
      size="sm"
      title={done ? "Redemption cancelled" : `Cancel ${row.itemName}?`}
      description={
        done
          ? `${formatAtc(row.price, { symbol: true })} is back in your balance.`
          : `You'll get ${formatAtc(row.price, { symbol: true })} back and the item returns to stock.`
      }
      footer={
        done ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Keep it
            </Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={() =>
                void tx.run({
                  label: `Cancel redemption #${row.id}`,
                  quiet: true,
                  send: ({ contracts }) => contracts.store.cancel(row.id),
                })
              }
            >
              Cancel redemption
            </Button>
          </>
        )
      }
    >
      <TxStatus state={tx.state} />
    </Dialog>
  );
}
