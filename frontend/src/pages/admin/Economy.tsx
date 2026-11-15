import { useQuery } from "@tanstack/react-query";
import { getAddress } from "ethers";
import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { describeError } from "@/lib/errors";
import { formatAtc, formatInteger, parseAtc } from "@/lib/format";
import { useTx } from "@/lib/tx";
import { useContracts } from "@/lib/wallet";
import { Badge } from "@/ui/Badge";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { Field, Input } from "@/ui/Field";
import { Page, PageHeader, Stack } from "@/ui/Page";
import { Panel } from "@/ui/Panel";
import { SkeletonText } from "@/ui/Skeleton";
import { TxStatus } from "@/ui/TxStatus";
import { cx } from "@/ui/cx";
import { addressError, useAdminKey, useProtocol, type Protocol } from "./data";
import { Steps } from "./Steps";
import { TxDialog } from "./TxDialog";
import shared from "./shared.module.css";
import styles from "./Economy.module.css";

type Contract = "token" | "manager" | "store";

export function AdminEconomy() {
  const protocol = useProtocol();
  const { hash } = useLocation();
  const [confirm, setConfirm] = useState<
    { kind: "pause"; contract: Contract } | { kind: "restrict" } | null
  >(null);
  const p = protocol.data;

  useEffect(() => {
    if (hash && p) document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [hash, p]);

  if (protocol.error) {
    return (
      <Page>
        <PageHeader eyebrow="Admin" title="Economy" />
        <EmptyState
          tone="danger"
          title="Couldn't read the contracts"
          body={describeError(protocol.error).message}
          action={
            <Button variant="secondary" onClick={() => void protocol.refetch()}>
              Try again
            </Button>
          }
        />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        eyebrow="Admin"
        title="Economy"
        description="How much attendance is worth, where spent ATC goes, and the emergency stops."
      />
      <Stack gap={6}>
        <Panel title="Rewards" description="Paid by AttendanceManager each time a check-in is recorded.">
          {p ? <RewardForm protocol={p} /> : <SkeletonText lines={4} />}
        </Panel>

        <Panel title="Transfers">
          {p ? (
            <SettingRow
              title={p.transferRestricted ? "Campus wallets only" : "Open to any wallet"}
              badge={
                p.transferRestricted ? (
                  <Badge tone="ink" dot>
                    Restricted
                  </Badge>
                ) : (
                  <Badge tone="mark" dot>
                    Open
                  </Badge>
                )
              }
              body={
                p.transferRestricted
                  ? "ATC can only move between active students and the store, so it can't be sold or sent off campus."
                  : "Anyone holding ATC can send it to any address, including exchanges and other students' friends."
              }
              action={
                <Button variant="secondary" onClick={() => setConfirm({ kind: "restrict" })}>
                  {p.transferRestricted ? "Open transfers" : "Restrict transfers"}
                </Button>
              }
            />
          ) : (
            <SkeletonText lines={2} />
          )}
        </Panel>

        <Panel title="At fulfilment" description="What happens to the ATC held for a redemption once a vendor hands the item over.">
          {p ? <SettlementForm protocol={p} /> : <SkeletonText lines={3} />}
        </Panel>

        <Panel id="pause" title="Emergency stops" description="Pausing is immediate and reversible. Use it while you investigate a problem.">
          {p ? (
            <div className={styles.rows}>
              {(["token", "manager", "store"] as const).map((c) => (
                <SettingRow
                  key={c}
                  title={PAUSE_COPY[c].name}
                  badge={
                    p.paused[c] ? (
                      <Badge tone="pen" dot>
                        Paused
                      </Badge>
                    ) : (
                      <Badge tone="ink" dot>
                        Running
                      </Badge>
                    )
                  }
                  body={c === "token" && !p.can.pauseToken ? `${PAUSE_COPY[c].effect} This wallet doesn't hold PAUSER_ROLE on the token.` : PAUSE_COPY[c].effect}
                  action={
                    <Button
                      variant={p.paused[c] ? "primary" : "danger"}
                      disabled={c === "token" && !p.can.pauseToken}
                      onClick={() => setConfirm({ kind: "pause", contract: c })}
                    >
                      {p.paused[c] ? "Resume" : "Pause"}
                    </Button>
                  }
                />
              ))}
            </div>
          ) : (
            <SkeletonText lines={6} />
          )}
        </Panel>
      </Stack>

      {confirm?.kind === "pause" && p && (
        <PauseDialog contract={confirm.contract} paused={p.paused[confirm.contract]} onClose={() => setConfirm(null)} />
      )}
      {confirm?.kind === "restrict" && p && (
        <TxDialog
          title={p.transferRestricted ? "Open transfers to any wallet?" : "Restrict transfers to campus wallets?"}
          doneTitle={p.transferRestricted ? "Transfers are open" : "Transfers are restricted"}
          description={
            p.transferRestricted
              ? "Students will be able to send ATC to any address. Tokens that leave campus can't be pulled back."
              : "From the next block, ATC can only move between allowlisted wallets: active students, the store and the treasury."
          }
          confirmLabel={p.transferRestricted ? "Open transfers" : "Restrict transfers"}
          tone={p.transferRestricted ? "danger" : "primary"}
          txLabel={p.transferRestricted ? "Open transfers" : "Restrict transfers"}
          send={({ contracts }) => contracts.token.setTransferRestricted(!p.transferRestricted)}
          onClose={() => setConfirm(null)}
        />
      )}
    </Page>
  );
}

const PAUSE_COPY: Record<Contract, { name: string; effect: string; resume: string }> = {
  token: {
    name: "AttendCoin token",
    effect:
      "Stops every ATC transfer, mint and burn. Attendance can't pay out, redemptions and fulfilment fail, and wallets can't be re-linked.",
    resume: "Transfers, rewards and the store work again.",
  },
  manager: {
    name: "Attendance",
    effect: "Teachers can't open sessions and no check-ins are recorded. Registration and course admin keep working.",
    resume: "Teachers can open sessions and check-ins are recorded again.",
  },
  store: {
    name: "Store",
    effect: "Students can't redeem items. Redemptions already made can still be fulfilled or cancelled.",
    resume: "Students can redeem items again.",
  },
};

function PauseDialog({ contract, paused, onClose }: { contract: Contract; paused: boolean; onClose: () => void }) {
  const copy = PAUSE_COPY[contract];
  return (
    <TxDialog
      title={paused ? `Resume ${copy.name}?` : `Pause ${copy.name}?`}
      doneTitle={paused ? `${copy.name} resumed` : `${copy.name} paused`}
      description={paused ? copy.resume : copy.effect}
      doneDescription={paused ? undefined : "Students and staff see the pause straight away. Resume it from this page."}
      confirmLabel={paused ? "Resume" : "Pause now"}
      tone={paused ? "primary" : "danger"}
      txLabel={`${paused ? "Resume" : "Pause"} ${copy.name}`}
      send={({ contracts }) => {
        const c = contracts[contract];
        return paused ? c.unpause() : c.pause();
      }}
      onClose={onClose}
    />
  );
}

function SettingRow({
  title,
  badge,
  body,
  action,
}: {
  title: ReactNode;
  badge: ReactNode;
  body: ReactNode;
  action: ReactNode;
}) {
  return (
    <div className={styles.setting}>
      <div className={styles.settingText}>
        <p className={styles.settingTitle}>
          {title}
          {badge}
        </p>
        <p className={shared.note}>{body}</p>
      </div>
      <div className={styles.settingAction}>{action}</div>
    </div>
  );
}

function safeParse(value: string): bigint | null {
  if (!/^\d*\.?\d*$/.test(value.trim()) || !value.trim() || value.trim() === ".") return null;
  try {
    return parseAtc(value);
  } catch {
    return null;
  }
}

const plain = (wei: bigint) => formatAtc(wei, { maxFractionDigits: 18 }).replace(/,/g, "");

function RewardForm({ protocol }: { protocol: Protocol }) {
  const { rules, bounds } = protocol;
  const tx = useTx();
  const [reward, setReward] = useState(() => plain(rules.reward));
  const [bonus, setBonus] = useState(() => plain(rules.bonus));
  const [length, setLength] = useState(() => String(rules.length));

  const r = safeParse(reward);
  const b = safeParse(bonus);
  const l = /^\d+$/.test(length.trim()) ? Number(length) : null;

  const rewardError =
    r == null ? "Enter an amount, e.g. 10." : r === 0n ? "Must be more than zero." : r > bounds.maxReward ? `At most ${formatAtc(bounds.maxReward)} ATC.` : null;
  const bonusError = b == null ? "Enter an amount; 0 turns the bonus off." : b > bounds.maxBonus ? `At most ${formatAtc(bounds.maxBonus)} ATC.` : null;
  const lengthError =
    l == null || l < bounds.minLength || l > bounds.maxLength
      ? `A whole number from ${bounds.minLength} to ${bounds.maxLength}.`
      : null;
  const valid = !rewardError && !bonusError && !lengthError;
  const changed = valid && (r !== rules.reward || b !== rules.bonus || l !== rules.length);

  const save = () => {
    if (!valid || r == null || b == null || l == null) return;
    void tx.run({
      label: "Update rewards",
      send: ({ contracts }) => contracts.manager.setRewardConfig(r, b, l),
    });
  };

  const streakTotal = valid && r != null && b != null && l != null ? r * BigInt(l) + b : null;

  return (
    <form
      className={shared.form}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <fieldset className={styles.fieldset} disabled={tx.busy}>
        <div className={shared.triple}>
          <Field
            label="Per attendance"
            error={rewardError}
            hint={`Up to ${formatAtc(bounds.maxReward)} ATC. Now ${formatAtc(rules.reward)}.`}
          >
            <Input inputMode="decimal" value={reward} onChange={(e) => setReward(e.target.value)} suffix="ATC" className="t-num" />
          </Field>
          <Field
            label="Streak bonus"
            error={bonusError}
            hint={`0 to ${formatAtc(bounds.maxBonus)} ATC. Now ${formatAtc(rules.bonus)}.`}
          >
            <Input inputMode="decimal" value={bonus} onChange={(e) => setBonus(e.target.value)} suffix="ATC" />
          </Field>
          <Field
            label="Streak length"
            error={lengthError}
            hint={`${bounds.minLength} to ${bounds.maxLength} sessions in a row. Now ${rules.length}.`}
          >
            <Input inputMode="numeric" value={length} onChange={(e) => setLength(e.target.value)} suffix="sessions" />
          </Field>
        </div>
      </fieldset>
      <div className={styles.formFoot}>
        <p className={shared.note} aria-live="polite">
          {streakTotal != null ? (
            <>
              A student who attends {formatInteger(l)} sessions in a row earns{" "}
              <strong className="t-mark t-num">{formatAtc(streakTotal)} ATC</strong>
              {b !== 0n && (
                <>
                  , including the <span className="t-num">{formatAtc(b)}</span> bonus
                </>
              )}
              .
            </>
          ) : (
            "Fix the highlighted values to see what a streak earns."
          )}
        </p>
        <Button type="submit" variant="primary" loading={tx.busy} disabled={!changed}>
          Save rewards
        </Button>
      </div>
      <TxStatus state={tx.state} onDismiss={tx.reset} />
    </form>
  );
}

function SettlementForm({ protocol }: { protocol: Protocol }) {
  const { read } = useContracts();
  const key = useAdminKey();
  const tx = useTx();
  const [burn, setBurn] = useState(protocol.burnOnSettle);
  const [treasury, setTreasury] = useState(protocol.treasury);
  const [step, setStep] = useState<"idle" | "allow" | "mode" | "done">("idle");

  const target = treasury.trim();
  const format = burn ? null : addressError(target);
  const allowed = useQuery({
    queryKey: [...key, "is-allowed", format ? "" : target.toLowerCase()],
    enabled: Boolean(read && !burn && !format),
    queryFn: () => read!.token.isAllowed(getAddress(target)),
  });

  const sameTreasury = target.toLowerCase() === protocol.treasury.toLowerCase();
  const changed = burn !== protocol.burnOnSettle || (!burn && !sameTreasury);
  const needsAllow = !burn && allowed.data === false;
  const blocked = needsAllow && !protocol.can.allowlist;
  const ready = changed && !format && (burn || allowed.isSuccess) && !blocked;

  const save = async () => {
    if (!ready) return;
    const dest = burn ? protocol.treasury : getAddress(target);
    if (needsAllow) {
      setStep("allow");
      const ok = await tx.run({
        label: "Allowlist the treasury",
        quiet: true,
        send: ({ contracts }) => contracts.token.setAllowed(dest, true),
        onConfirmed: () => true,
      });
      if (!ok) return;
    }
    setStep("mode");
    const ok = await tx.run({
      label: burn ? "Burn at fulfilment" : "Send to treasury at fulfilment",
      send: ({ contracts }) => contracts.store.setSettlementMode(burn, dest),
      onConfirmed: () => true,
    });
    setStep(ok ? "done" : "mode");
  };

  return (
    <div className={shared.form}>
      <fieldset className={styles.choices} disabled={tx.busy}>
        <legend className="visually-hidden">Settlement mode</legend>
        <label className={cx(styles.choice, burn && styles.chosen)}>
          <input type="radio" name="settlement" checked={burn} onChange={() => setBurn(true)} />
          <span>
            <span className={styles.choiceTitle}>Burn it</span>
            <span className={shared.note}>Spent ATC leaves circulation. Supply only grows from attendance.</span>
          </span>
        </label>
        <label className={cx(styles.choice, !burn && styles.chosen)}>
          <input type="radio" name="settlement" checked={!burn} onChange={() => setBurn(false)} />
          <span>
            <span className={styles.choiceTitle}>Send to the treasury</span>
            <span className={shared.note}>The college keeps spent ATC and can reuse it for prizes or events.</span>
          </span>
        </label>
      </fieldset>

      {!burn && (
        <Field
          label="Treasury wallet"
          error={target.length >= 42 || !target ? format : null}
          hint={
            allowed.data === false
              ? protocol.can.allowlist
                ? "Not on the campus allowlist yet. It will be added first, in a separate transaction."
                : undefined
              : allowed.data
                ? "On the campus allowlist."
                : undefined
          }
        >
          <Input mono value={treasury} onChange={(e) => setTreasury(e.target.value)} spellCheck={false} autoComplete="off" />
        </Field>
      )}
      {blocked && (
        <p className={cx(shared.callout, shared.danger)} role="alert">
          The treasury has to be on the campus allowlist, and this wallet doesn't hold REGISTRAR_ROLE on the token to add
          it. Ask the deployer to allowlist it or grant the role.
        </p>
      )}

      <div className={styles.formFoot}>
        {needsAllow && step !== "idle" && step !== "done" ? (
          <Steps steps={["Allowlist treasury", "Switch mode"]} active={step === "allow" ? 0 : 1} working={tx.busy} />
        ) : (
          <p className={shared.note}>
            Now:{" "}
            <strong>
              {protocol.burnOnSettle ? "burn" : `send to ${protocol.treasury.slice(0, 6)}…${protocol.treasury.slice(-4)}`}
            </strong>
          </p>
        )}
        <Button variant="primary" loading={tx.busy} disabled={!ready} onClick={() => void save()}>
          Save
        </Button>
      </div>
      <TxStatus state={tx.state} onDismiss={tx.reset} />
    </div>
  );
}
