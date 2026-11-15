import { ArrowRight } from "lucide-react";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { chain } from "@/lib/contracts";
import { formatAtc } from "@/lib/format";
import { ROLE_LABEL, homePathFor, useRoles } from "@/lib/roles";
import { useContracts, useWallet } from "@/lib/wallet";
import { useRewardRules } from "./student/data";
import { ConnectPanel } from "@/shell/ConnectPanel";
import { NotDeployed } from "@/shell/RequireRole";
import { WrongNetwork } from "@/shell/WrongNetwork";
import { AddressChip } from "@/ui/AddressChip";
import { Button } from "@/ui/Button";
import { Skeleton, SkeletonText } from "@/ui/Skeleton";
import styles from "./Landing.module.css";

export function Landing() {
  const wallet = useWallet();
  const { deployed } = useContracts();
  const roles = useRoles();
  const navigate = useNavigate();
  const wasConnected = useRef(Boolean(wallet.address));

  const rules = useRewardRules();

  // Only jump straight in when the wallet was connected from this page;
  // someone who navigates back here on purpose should be able to stay.
  useEffect(() => {
    if (!wallet.address) {
      wasConnected.current = false;
      return;
    }
    if (wasConnected.current || !roles.ready) return;
    wasConnected.current = true;
    if (roles.roles.length === 1) navigate(homePathFor(roles.roles[0]));
  }, [wallet.address, roles.ready, roles.roles, navigate]);

  if (!deployed) return <NotDeployed />;

  return (
    <div className={styles.page}>
      <section className={styles.intro}>
        <h1 className={`${styles.title} t-display`}>
          Attendance, kept in a <em>ledger</em> you can check.
        </h1>
        <p className={styles.lede}>
          Scan your teacher&rsquo;s code to check in. Every session you attend is recorded on {chain.name} and pays
          ATC you can spend at campus vendors.
        </p>

        <dl className={styles.rules} aria-busy={rules.isLoading}>
          <div className={styles.rule}>
            <dt>Per session attended</dt>
            <dd className="t-num t-mark">{rules.data ? formatAtc(rules.data.reward, { symbol: true }) : <Skeleton width={64} height={16} />}</dd>
          </div>
          <div className={styles.rule}>
            <dt>
              Streak bonus, every {rules.data ? rules.data.length : "few"} sessions in a row
            </dt>
            <dd className="t-num t-pen">{rules.data ? `+${formatAtc(rules.data.bonus, { symbol: true })}` : <Skeleton width={64} height={16} />}</dd>
          </div>
          <div className={styles.rule}>
            <dt>Cost to check in</dt>
            <dd className="t-num t-ink">Free, a signature only</dd>
          </div>
        </dl>
      </section>

      <section className={styles.side} aria-label="Account">
        {!wallet.address ? (
          <>
            <h2 className={styles.sideTitle}>Connect to continue</h2>
            <ConnectPanel />
          </>
        ) : !wallet.isCorrectChain ? (
          <WrongNetwork />
        ) : (
          <>
            <h2 className={styles.sideTitle}>Continue</h2>
            <AddressChip address={wallet.address} explorer />
            {roles.isLoading ? (
              <SkeletonText lines={2} />
            ) : roles.roles.length === 0 ? (
              <p className={styles.none}>
                This wallet has no AttendCoin role yet. Students are registered by an admin using their roll number;
                share the address above with them.
              </p>
            ) : (
              <ul className={styles.roleList}>
                {roles.roles.map((r) => (
                  <li key={r}>
                    <Button
                      to={homePathFor(r)}
                      variant={r === roles.roles[0] ? "primary" : "secondary"}
                      size="lg"
                      full
                      trailing={<ArrowRight size={16} aria-hidden="true" />}
                    >
                      {ROLE_LABEL[r]}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  );
}
