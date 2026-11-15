import { useQuery } from "@tanstack/react-query";
import type { EventLog } from "ethers";
import type { ReactNode } from "react";
import { deployment, explorerTxUrl } from "@/lib/contracts";
import { atcToNumber, formatAtc, formatDateTime, formatInteger, formatPercent, formatRelative, pluralize, ratio } from "@/lib/format";
import { useContracts, useWallet } from "@/lib/wallet";
import { logsFromBlock } from "@/lib/contracts";
import { AddressChip } from "@/ui/AddressChip";
import { Badge } from "@/ui/Badge";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { Meter } from "@/ui/Meter";
import { Page, PageHeader, Stack } from "@/ui/Page";
import { Panel } from "@/ui/Panel";
import { Skeleton } from "@/ui/Skeleton";
import { Stat, StatGroup } from "@/ui/Stat";
import { cx } from "@/ui/cx";
import {
  blockTimes,
  byNewest,
  isEventLog,
  useAdminKey,
  useCourses,
  useProtocol,
  useRoleHolders,
  useStudents,
  type AdminCourse,
} from "./data";
import styles from "./Overview.module.css";

const atc = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

export function AdminOverview() {
  const protocol = useProtocol();
  const students = useStudents();
  const teachers = useRoleHolders("teacher");
  const courses = useCourses();
  const p = protocol.data;

  const activeStudents = students.data?.students.filter((s) => s.active).length;
  const activeCourses = courses.data?.filter((c) => c.active).length;
  const used = p ? ratio(atcToNumber(p.supply), atcToNumber(p.cap)) : null;
  const anyPaused = p && (p.paused.token || p.paused.manager || p.paused.store);

  if (protocol.error) {
    return (
      <Page>
        <PageHeader eyebrow="Admin" title="Overview" />
        <EmptyState
          tone="danger"
          title="Couldn't read the contracts"
          body="The blockchain node didn't respond. Check that it's running and that the deployment file matches it."
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
        title="Overview"
        actions={
          <>
            <Button variant="secondary" to="/admin/economy">
              Economy settings
            </Button>
            <Button variant="primary" to="/admin/people?register=1">
              Register student
            </Button>
          </>
        }
      />

      <Stack gap={6}>
        {anyPaused && (
          <div className={styles.alert} role="status">
            <Badge tone="pen" dot>
              Paused
            </Badge>
            <p>
              {[p.paused.token && "AttendCoin", p.paused.manager && "Attendance", p.paused.store && "the store"]
                .filter(Boolean)
                .join(", ")}{" "}
              {[p.paused.token, p.paused.manager, p.paused.store].filter(Boolean).length === 1 ? "is" : "are"} paused.
              Students can't earn or spend until you resume.
            </p>
            <Button size="sm" variant="secondary" to="/admin/economy#pause">
              Review
            </Button>
          </div>
        )}

        <section className={styles.ledger} aria-label="Token supply">
          <div className={styles.supply}>
            <StatGroup>
              <Stat
                label="In circulation"
                size="xl"
                tone="mark"
                unit="ATC"
                loading={protocol.isLoading}
                value={p ? atcToNumber(p.supply) : null}
                format={atc}
              />
            </StatGroup>
            <div className={styles.capRow}>
              <Meter value={used} label="Share of supply cap in circulation" tone="ink" />
              <p className={styles.capText}>
                {p ? (
                  <>
                    <span className="t-num">{formatPercent(used, used != null && used < 0.01 ? 2 : 1)}</span> of the{" "}
                    <span className="t-num">{formatAtc(p.cap)}</span> ATC cap ·{" "}
                    <span className="t-num">{formatAtc(p.cap - p.supply)}</span> left to mint
                  </>
                ) : (
                  <Skeleton width={260} />
                )}
              </p>
            </div>
          </div>
          <StatGroup className={styles.flows}>
            <Stat
              label="Rewarded, all time"
              unit="ATC"
              loading={protocol.isLoading}
              value={p ? atcToNumber(p.totalRewarded) : null}
              format={atc}
            />
            <Stat
              label="Held for pickup"
              unit="ATC"
              loading={protocol.isLoading}
              value={p ? atcToNumber(p.escrow) : null}
              format={atc}
            />
            <Stat
              label="Burned at the counter"
              unit="ATC"
              loading={protocol.isLoading}
              value={p ? atcToNumber(p.totalBurned) : null}
              format={atc}
            />
            <Stat
              label="Sent to treasury"
              unit="ATC"
              loading={protocol.isLoading}
              value={p ? atcToNumber(p.totalToTreasury) : null}
              format={atc}
            />
          </StatGroup>
        </section>

        <Panel>
          <StatGroup className={styles.counts}>
            <Stat
              label="Active students"
              loading={students.isLoading}
              value={activeStudents ?? null}
              delta={students.data && `${formatInteger(students.data.students.length)} registered`}
            />
            <Stat label="Teachers" loading={teachers.isLoading} value={teachers.data?.length ?? null} />
            <Stat
              label="Active courses"
              loading={courses.isLoading}
              value={activeCourses ?? null}
              delta={courses.data && `${formatInteger(courses.data.length)} created`}
            />
            <Stat
              label="Sessions held"
              loading={protocol.isLoading}
              value={p?.counts.sessions ?? null}
              delta={p && `${pluralize(p.counts.redemptions, "redemption")} in the store`}
            />
          </StatGroup>
        </Panel>

        <div className={styles.split}>
          <Activity courses={courses.data} />
          <Panel
            title="Contracts"
            actions={
              <Button size="sm" variant="ghost" to="/admin/economy#pause">
                Manage
              </Button>
            }
          >
            <dl className={styles.contracts}>
              <ContractRow name="AttendCoin" address={deployment?.contracts.AttendCoin} paused={p?.paused.token} />
              <ContractRow
                name="AttendanceManager"
                address={deployment?.contracts.AttendanceManager}
                paused={p?.paused.manager}
              />
              <ContractRow name="RewardStore" address={deployment?.contracts.RewardStore} paused={p?.paused.store} />
              <div className={styles.policy}>
                <dt>Transfers</dt>
                <dd>{p ? (p.transferRestricted ? "Campus wallets only" : "Open") : <Skeleton width={96} />}</dd>
              </div>
              <div className={styles.policy}>
                <dt>At fulfilment</dt>
                <dd>{p ? (p.burnOnSettle ? "Burn the ATC" : "Send to treasury") : <Skeleton width={96} />}</dd>
              </div>
            </dl>
          </Panel>
        </div>
      </Stack>
    </Page>
  );
}

function ContractRow({ name, address, paused }: { name: string; address?: string; paused?: boolean }) {
  return (
    <div className={styles.contract}>
      <dt>
        <span className={styles.contractName}>{name}</span>
        {address && <AddressChip address={address} explorer />}
      </dt>
      <dd>
        {paused == null ? (
          <Skeleton width={72} />
        ) : paused ? (
          <Badge tone="pen" dot>
            Paused
          </Badge>
        ) : (
          <Badge tone="ink" dot>
            Running
          </Badge>
        )}
      </dd>
    </div>
  );
}

type Tone = "mark" | "ink" | "pen" | "neutral";

interface ActivityEntry {
  key: string;
  tone: Tone;
  text: ReactNode;
  time: number | null;
  txHash: string;
}

const ACTIVITY_LIMIT = 14;

function useActivity(courses: AdminCourse[] | undefined) {
  const { read } = useContracts();
  const { provider } = useWallet();
  const key = useAdminKey();
  return useQuery({
    queryKey: [...key, "activity", courses?.length ?? 0],
    enabled: Boolean(read && provider && courses),
    refetchInterval: 30_000,
    queryFn: async (): Promise<ActivityEntry[]> => {
      const { token, manager, store } = read!;
      const from = await logsFromBlock(provider!);
      const [t, m, s] = await Promise.all([
        token.queryFilter("*", from),
        manager.queryFilter("*", from),
        store.queryFilter("*", from),
      ]);
      const code = (id: unknown) => courses!.find((c) => c.id === BigInt(id as bigint))?.code ?? `Course ${id}`;
      const tagged = [
        ...t.filter(isEventLog).map((log) => ({ log, source: "token" as const })),
        ...m.filter(isEventLog).map((log) => ({ log, source: "manager" as const })),
        ...s.filter(isEventLog).map((log) => ({ log, source: "store" as const })),
      ].sort((a, b) => byNewest(a.log, b.log));

      // Batches arrive as one event per student; show each batch as one line.
      const grouped: { logs: EventLog[]; source: "token" | "manager" | "store" }[] = [];
      for (const item of tagged) {
        const last = grouped[grouped.length - 1];
        const batchable = item.log.eventName === "AttendanceRecorded" || item.log.eventName === "StudentEnrolled";
        if (
          batchable &&
          last &&
          last.logs[0].eventName === item.log.eventName &&
          last.logs[0].transactionHash === item.log.transactionHash
        ) {
          last.logs.push(item.log);
        } else {
          grouped.push({ logs: [item.log], source: item.source });
        }
      }

      const entries: Omit<ActivityEntry, "time">[] = [];
      const blocks: number[] = [];
      for (const g of grouped) {
        if (entries.length >= ACTIVITY_LIMIT) break;
        const described = describe(g.logs, g.source, code);
        if (!described) continue;
        const first = g.logs[0];
        entries.push({ key: `${first.transactionHash}-${first.index}`, txHash: first.transactionHash, ...described });
        blocks.push(first.blockNumber);
      }
      const times = await blockTimes(provider!, blocks);
      return entries.map((e, i) => ({ ...e, time: times.get(blocks[i]) ?? null }));
    },
  });
}

const CONTRACT_LABEL = { token: "AttendCoin", manager: "Attendance", store: "The store" } as const;

function describe(
  logs: EventLog[],
  source: "token" | "manager" | "store",
  code: (id: unknown) => string,
): { tone: Tone; text: ReactNode } | null {
  const [log] = logs;
  const a = log.args;
  switch (log.eventName) {
    case "AttendanceRecorded": {
      const minted = logs.reduce((sum, l) => sum + (l.args.reward as bigint) + (l.args.bonus as bigint), 0n);
      const manual = logs.filter((l) => l.args.manual).length;
      return {
        tone: "ink",
        text: (
          <>
            <strong>{pluralize(logs.length, "check-in")}</strong> recorded in {code(a.courseId)} ·{" "}
            <span className="t-mark t-num">{formatAtc(minted)} ATC</span> minted
            {manual > 0 && <span className="t-muted"> · {formatInteger(manual)} manual</span>}
          </>
        ),
      };
    }
    case "StudentEnrolled":
      return {
        tone: "neutral",
        text: (
          <>
            <strong>{pluralize(logs.length, "student")}</strong> enrolled in {code(a.courseId)}
          </>
        ),
      };
    case "StudentRegistered":
      return { tone: "neutral", text: <>Student <strong>#{String(a.studentId)}</strong> registered</> };
    case "StudentStatusChanged":
      return {
        tone: a.active ? "ink" : "pen",
        text: (
          <>
            Student <strong>#{String(a.studentId)}</strong> {a.active ? "reactivated" : "deactivated"}
          </>
        ),
      };
    case "StudentRelinked":
      return {
        tone: "mark",
        text: (
          <>
            Student <strong>#{String(a.studentId)}</strong> moved to a new wallet with{" "}
            <span className="t-num">{formatAtc(a.moved as bigint)} ATC</span>
          </>
        ),
      };
    case "CourseCreated":
      return { tone: "neutral", text: <>Course <strong>{String(a.code)}</strong> created</> };
    case "CourseTeacherChanged":
      return { tone: "neutral", text: <>New teacher assigned to <strong>{code(a.courseId)}</strong></> };
    case "CourseStatusChanged":
      return {
        tone: a.active ? "ink" : "pen",
        text: (
          <>
            <strong>{code(a.courseId)}</strong> {a.active ? "reactivated" : "deactivated"}
          </>
        ),
      };
    case "SessionOpened":
      return {
        tone: "pen",
        text: (
          <>
            Session {String(a.index)} of <strong>{code(a.courseId)}</strong> opened
          </>
        ),
      };
    case "SessionFinalized":
      return {
        tone: "neutral",
        text: (
          <>
            Session of <strong>{code(a.courseId)}</strong> finalized with {pluralize(Number(a.attendeeCount), "attendee")}
          </>
        ),
      };
    case "RewardConfigUpdated":
      return {
        tone: "mark",
        text: (
          <>
            Rewards set to <span className="t-num">{formatAtc(a.rewardPerAttendance as bigint)}</span> ATC, bonus{" "}
            <span className="t-num">{formatAtc(a.streakBonus as bigint)}</span> every {String(a.streakLength)} in a row
          </>
        ),
      };
    case "SupplyCapReached":
      return { tone: "pen", text: <>Supply cap reached; a reward was paid short</> };
    case "Redeemed":
      return {
        tone: "mark",
        text: (
          <>
            Redemption <strong>#{String(a.redemptionId)}</strong> for{" "}
            <span className="t-num">{formatAtc(a.price as bigint)} ATC</span>
          </>
        ),
      };
    case "Fulfilled":
      return {
        tone: "ink",
        text: (
          <>
            Redemption <strong>#{String(a.redemptionId)}</strong> handed over{a.burned ? ", ATC burned" : ", ATC to treasury"}
          </>
        ),
      };
    case "Cancelled":
      return { tone: "neutral", text: <>Redemption <strong>#{String(a.redemptionId)}</strong> cancelled and refunded</> };
    case "ItemCreated":
      return { tone: "neutral", text: <>Store item <strong>{String(a.name)}</strong> listed</> };
    case "ItemUpdated":
      return { tone: "neutral", text: <>Store item <strong>#{String(a.itemId)}</strong> updated</> };
    case "SettlementModeUpdated":
      return {
        tone: "mark",
        text: <>Fulfilled redemptions now {a.burnOnSettle ? "burn their ATC" : "go to the treasury"}</>,
      };
    case "TransferRestrictionUpdated":
      return {
        tone: "mark",
        text: <>Transfers {a.restricted ? "limited to campus wallets" : "opened to any wallet"}</>,
      };
    case "Paused":
      return { tone: "pen", text: <><strong>{CONTRACT_LABEL[source]}</strong> paused</> };
    case "Unpaused":
      return { tone: "ink", text: <><strong>{CONTRACT_LABEL[source]}</strong> resumed</> };
    default:
      return null;
  }
}

function Activity({ courses }: { courses: AdminCourse[] | undefined }) {
  const activity = useActivity(courses);
  return (
    <Panel title="Recent activity" description="From contract events, newest first." flush>
      {activity.error ? (
        <EmptyState
          compact
          tone="danger"
          title="Couldn't load activity"
          body="The node refused the event query. Large ranges can be slow on public RPCs."
          action={
            <Button size="sm" variant="secondary" onClick={() => void activity.refetch()}>
              Try again
            </Button>
          }
          className={styles.inset}
        />
      ) : !activity.data ? (
        <ul className={styles.feed} aria-busy="true" aria-label="Loading activity">
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className={styles.entry}>
              <span className={styles.dot} />
              <Skeleton width={`${60 + ((i * 13) % 30)}%`} />
            </li>
          ))}
        </ul>
      ) : activity.data.length === 0 ? (
        <EmptyState
          compact
          className={styles.inset}
          title="No activity yet"
          body="Register students and create a course; their events show up here."
        />
      ) : (
        <ol className={styles.feed}>
          {activity.data.map((e) => {
            const url = explorerTxUrl(e.txHash);
            return (
              <li key={e.key} className={styles.entry}>
                <span className={cx(styles.dot, styles[e.tone])} aria-hidden="true" />
                <p className={styles.entryText}>{e.text}</p>
                {e.time ? (
                  <time
                    className={styles.time}
                    dateTime={new Date(e.time * 1000).toISOString()}
                    title={formatDateTime(e.time)}
                  >
                    {url ? (
                      <a href={url} target="_blank" rel="noreferrer" className="link">
                        {formatRelative(e.time)}
                      </a>
                    ) : (
                      formatRelative(e.time)
                    )}
                  </time>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
