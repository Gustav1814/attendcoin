import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { chain, deployment, readAllItems, type ItemView } from "@/lib/contracts";
import { signPermit } from "@/lib/eip712";
import { describeError } from "@/lib/errors";
import { atcToNumber, formatAtc, pluralize } from "@/lib/format";
import { useTx } from "@/lib/tx";
import { useChainKey, useContracts, useWallet } from "@/lib/wallet";
import { Badge } from "@/ui/Badge";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { EmptyState } from "@/ui/EmptyState";
import { Page, PageHeader, Stack } from "@/ui/Page";
import { Panel } from "@/ui/Panel";
import { Stat, StatGroup } from "@/ui/Stat";
import { Table, type Column } from "@/ui/Table";
import { TxStatus } from "@/ui/TxStatus";
import { useToast } from "@/ui/Toast";
import { useAtcBalance } from "./data";
import styles from "./Store.module.css";

/** Permits are signed for a short window; long enough to confirm, short enough to be useless if leaked. */
const PERMIT_TTL_S = 20 * 60;

interface StoreItem extends ItemView {
  used: number;
}

function useStoreItems() {
  const { read } = useContracts();
  const { address } = useWallet();
  const key = useChainKey();
  return useQuery({
    queryKey: [...key, "store-items"],
    enabled: Boolean(read && address),
    queryFn: async () => {
      const { store } = read!;
      const [items, paused] = await Promise.all([readAllItems(store), store.paused()]);
      const active = items.filter((i) => i.active);
      const used = await Promise.all(
        active.map((i) => (i.perStudentLimit > 0 ? store.redeemedCount(i.id, address!) : Promise.resolve(0n))),
      );
      return {
        paused,
        items: active.map<StoreItem>((i, n) => ({ ...i, used: Number(used[n]) })),
      };
    },
  });
}

function blockedReason(item: StoreItem, balance: bigint | undefined, paused: boolean): string | null {
  if (paused) return "Store paused";
  if (item.stock === 0) return "Sold out";
  if (item.perStudentLimit > 0 && item.used >= item.perStudentLimit) return "Limit reached";
  if (balance != null && balance < item.price) return `Need ${formatAtc(item.price - balance)} more`;
  return null;
}

export function StoreFront() {
  const balance = useAtcBalance();
  const items = useStoreItems();
  const [selected, setSelected] = useState<StoreItem | null>(null);
  const paused = items.data?.paused ?? false;

  const columns: Column<StoreItem>[] = [
    {
      key: "name",
      header: "Item",
      render: (i) => (
        <div className={styles.item}>
          <span className={styles.name}>{i.name}</span>
          {/^https?:\/\//.test(i.metadataURI) && (
            <a href={i.metadataURI} target="_blank" rel="noreferrer" className={`${styles.details} link`}>
              Details <ExternalLink size={11} aria-hidden="true" />
            </a>
          )}
        </div>
      ),
    },
    {
      key: "stock",
      header: "Stock",
      align: "right",
      numeric: true,
      hideOnMobile: true,
      render: (i) => (i.stock === 0 ? <span className="t-pen">Sold out</span> : `${i.stock} left`),
    },
    {
      key: "limit",
      header: "Your limit",
      align: "right",
      numeric: true,
      hideOnMobile: true,
      render: (i) =>
        i.perStudentLimit === 0 ? (
          <span className="t-muted">None</span>
        ) : (
          <span>
            {i.used}
            <span className="t-muted"> of {i.perStudentLimit}</span>
          </span>
        ),
    },
    {
      key: "price",
      header: "Price (ATC)",
      align: "right",
      numeric: true,
      render: (i) => <span className={`t-mark ${styles.price}`}>{formatAtc(i.price)}</span>,
    },
    {
      key: "action",
      header: <span className="visually-hidden">Action</span>,
      align: "right",
      width: "1%",
      render: (i) => {
        const reason = blockedReason(i, balance.data, paused);
        return reason ? (
          <span className={styles.reason}>{reason}</span>
        ) : (
          <Button size="sm" onClick={() => setSelected(i)} aria-label={`Redeem ${i.name}`}>
            Redeem
          </Button>
        );
      },
    },
  ];

  return (
    <Page>
      <PageHeader
        eyebrow="Student"
        title="Store"
        description="Spend ATC on rewards from campus vendors. Collect them at the counter with your redemption code."
        actions={
          <Button variant="secondary" to="/student/redemptions">
            Your redemptions
          </Button>
        }
      />
      <Stack gap={6}>
        <StatGroup className={styles.balance}>
          <Stat
            label="Available to spend"
            size="lg"
            tone="mark"
            unit="ATC"
            loading={balance.isLoading}
            value={balance.data != null ? atcToNumber(balance.data) : null}
            format={(n) => n.toLocaleString("en-US", { maximumFractionDigits: 2 })}
          />
        </StatGroup>

        {paused && (
          <EmptyState
            tone="danger"
            compact
            title="The store is paused"
            body="An admin has paused redemptions. Items will be available again when it reopens."
          />
        )}

        <Panel flush>
          {items.error ? (
            <EmptyState
              tone="danger"
              compact
              title="Couldn't load the store"
              body="The blockchain node didn't respond."
              action={
                <Button size="sm" variant="secondary" onClick={() => void items.refetch()}>
                  Try again
                </Button>
              }
            />
          ) : (
            <Table
              label="Store items"
              columns={columns}
              rows={items.data?.items}
              loading={items.isLoading}
              rowKey={(i) => i.id.toString()}
              empty={<EmptyState compact title="Nothing in the store yet" body="Vendors haven't listed any rewards. Check back later." />}
            />
          )}
        </Panel>
      </Stack>

      {selected && <RedeemDialog item={selected} balance={balance.data} onClose={() => setSelected(null)} />}
    </Page>
  );
}

type Step = "confirm" | "permit" | "approve" | "redeem" | "done";

function RedeemDialog({ item, balance, onClose }: { item: StoreItem; balance: bigint | undefined; onClose: () => void }) {
  const { read, write } = useContracts();
  const { signer, address } = useWallet();
  const tx = useTx();
  const toast = useToast();
  const [step, setStep] = useState<Step>("confirm");
  const [usedApprove, setUsedApprove] = useState(false);
  const storeAddress = deployment!.contracts.RewardStore;
  const busy = step !== "confirm" && step !== "done" && tx.state.phase !== "failed";

  const label = `Redeem ${item.name}`;

  const redeemDirect = () =>
    tx.run({ label, send: ({ contracts }) => contracts.store.redeem(item.id), onConfirmed: () => true });

  const start = async () => {
    if (!read || !write || !signer || !address) return;
    tx.reset();
    const allowance = await read.token.allowance(address, storeAddress);
    if (allowance >= item.price) {
      setStep("redeem");
      if (await redeemDirect()) setStep("done");
      return;
    }

    setStep("permit");
    let fallback = false;
    let permit: Awaited<ReturnType<typeof signPermit>> | null = null;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + PERMIT_TTL_S);
    try {
      const nonce = await read.token.nonces(address);
      permit = await signPermit(signer, {
        chainId: chain.chainId,
        token: deployment!.contracts.AttendCoin,
        owner: address,
        spender: storeAddress,
        value: item.price,
        nonce,
        deadline,
      });
      await write.store.redeemWithPermit.estimateGas(item.id, deadline, permit.v, permit.r, permit.s);
    } catch (err) {
      const e = describeError(err);
      if (e.rejected) {
        setStep("confirm");
        return;
      }
      // Some wallets can't sign typed data, and a permit can fail verification; a plain
      // approval always works. Any other revert is real and is shown by the redeem step.
      fallback = !permit || Boolean(e.revertName?.startsWith("ERC2612"));
    }

    if (!fallback && permit) {
      const p = permit;
      setStep("redeem");
      const ok = await tx.run({
        label,
        send: ({ contracts }) => contracts.store.redeemWithPermit(item.id, deadline, p.v, p.r, p.s),
        onConfirmed: () => true,
      });
      if (ok) setStep("done");
      return;
    }

    setUsedApprove(true);
    setStep("approve");
    const approved = await tx.run({
      label: "Approve ATC",
      quiet: true,
      send: ({ contracts }) => contracts.token.approve(storeAddress, item.price),
      onConfirmed: () => true,
    });
    if (!approved) return;
    toast.push({ tone: "neutral", title: "Approved", body: "Now confirm the redemption in your wallet." });
    setStep("redeem");
    if (await redeemDirect()) setStep("done");
  };

  const after = balance != null ? balance - item.price : null;
  const steps = usedApprove ? ["Approve ATC", "Redeem"] : ["Sign permit", "Redeem"];
  const activeStep = step === "permit" || step === "approve" ? 0 : step === "redeem" ? 1 : step === "done" ? 2 : -1;

  return (
    <Dialog
      open
      onClose={() => !busy && onClose()}
      dismissible={!busy}
      title={step === "done" ? "Redeemed" : item.name}
      description={
        step === "done"
          ? "Show your redemption code at the vendor's counter to collect it."
          : "Redeeming moves the ATC to the store. You can cancel and get a refund until the vendor hands it over."
      }
      footer={
        step === "done" ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button to="/student/redemptions">Show code</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void start()} loading={busy} disabled={!signer}>
              {tx.state.phase === "failed" ? "Try again" : `Redeem for ${formatAtc(item.price, { symbol: true })}`}
            </Button>
          </>
        )
      }
    >
      <dl className={styles.summary}>
        <div>
          <dt>Price</dt>
          <dd className="t-num t-mark">{formatAtc(item.price, { symbol: true })}</dd>
        </div>
        <div>
          <dt>Balance after</dt>
          <dd className="t-num">{after != null ? formatAtc(after, { symbol: true }) : "—"}</dd>
        </div>
        {item.perStudentLimit > 0 && (
          <div>
            <dt>Your limit</dt>
            <dd className="t-num">
              {item.used + (step === "done" ? 1 : 0)} of {pluralize(item.perStudentLimit, "redemption")}
            </dd>
          </div>
        )}
      </dl>

      {activeStep >= 0 && (
        <ol className={styles.steps} aria-label="Progress">
          {steps.map((s, n) => (
            <li key={s} className={n < activeStep ? styles.stepDone : n === activeStep ? styles.stepActive : undefined}>
              <Badge tone={n < activeStep ? "ink" : n === activeStep ? "mark" : "neutral"}>{n + 1}</Badge>
              {s}
            </li>
          ))}
        </ol>
      )}

      {step === "permit" && tx.state.phase === "idle" && (
        <p className={styles.hint} role="status">
          Sign the spending permit in your wallet. It lets the store take exactly {formatAtc(item.price, { symbol: true })}; no
          gas is used for this step.
        </p>
      )}
      <TxStatus state={tx.state} />
    </Dialog>
  );
}
