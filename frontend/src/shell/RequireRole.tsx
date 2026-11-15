import { type ReactNode } from "react";
import { NETWORK } from "@/lib/contracts";
import { ROLE_LABEL, homePathFor, useRoles, type Role } from "@/lib/roles";
import { useContracts, useWallet } from "@/lib/wallet";
import { AddressChip } from "@/ui/AddressChip";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { Page, PageHeader } from "@/ui/Page";
import { Panel } from "@/ui/Panel";
import { LoadingRegion, SkeletonText } from "@/ui/Skeleton";
import { ConnectPanel } from "./ConnectPanel";
import { WrongNetwork } from "./WrongNetwork";

const NOT_GRANTED: Record<Role, string> = {
  student: "This wallet isn't registered as a student. Ask an admin to register it with your roll number.",
  teacher: "This wallet doesn't have the teacher role. An admin can grant it.",
  admin: "This wallet isn't an AttendCoin admin.",
  vendor: "This wallet isn't a registered vendor. An admin can add it to the store.",
};

/**
 * Gate for a role's pages. Handles every state before the role is confirmed so
 * pages can assume a connected wallet on the right chain with that role.
 */
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const wallet = useWallet();
  const { deployed } = useContracts();
  const roles = useRoles();

  if (!deployed) return <NotDeployed />;

  if (!wallet.address) {
    if (wallet.status === "connecting") return <Checking label="Reconnecting wallet" />;
    return (
      <Page width="narrow">
        <PageHeader eyebrow={ROLE_LABEL[role]} title="Connect your wallet" description="Connect the wallet linked to your AttendCoin account to continue." />
        <Panel>
          <ConnectPanel />
        </Panel>
      </Page>
    );
  }

  if (!wallet.isCorrectChain) {
    return (
      <Page width="narrow">
        <WrongNetwork />
      </Page>
    );
  }

  if (roles.isLoading) return <Checking label="Checking your roles" />;

  if (roles.error) {
    return (
      <Page width="narrow">
        <EmptyState
          tone="danger"
          title="Couldn't read your roles"
          body="The blockchain node didn't answer. Check that it's running, then try again."
          action={<Button onClick={roles.refetch}>Try again</Button>}
        />
      </Page>
    );
  }

  if (!roles.has[role]) {
    const others = roles.roles.filter((r) => r !== role);
    return (
      <Page width="narrow">
        <EmptyState
          title={`No ${ROLE_LABEL[role].toLowerCase()} access`}
          body={
            <>
              <span style={{ display: "block", marginBottom: "var(--space-3)" }}>{NOT_GRANTED[role]}</span>
              <AddressChip address={wallet.address} />
            </>
          }
          action={
            others.length > 0 ? (
              <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
                {others.map((r) => (
                  <Button key={r} variant="secondary" to={homePathFor(r)}>
                    Go to {ROLE_LABEL[r]}
                  </Button>
                ))}
              </div>
            ) : undefined
          }
        />
      </Page>
    );
  }

  return <>{children}</>;
}

function Checking({ label }: { label: string }) {
  return (
    <Page width="narrow">
      <LoadingRegion label={label}>
        <SkeletonText lines={3} />
      </LoadingRegion>
    </Page>
  );
}

export function NotDeployed() {
  return (
    <Page width="narrow">
      <EmptyState
        tone="danger"
        title="Contracts aren't deployed"
        body={
          <>
            No deployment file was found for <span className="t-mono">{NETWORK}</span>. Run the deploy script for this
            network; it writes <span className="t-mono">src/contracts/deployment.{NETWORK}.json</span>.
          </>
        }
      />
    </Page>
  );
}
