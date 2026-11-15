import { Suspense } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { ROLE_LABEL, homePathFor, useRoles } from "@/lib/roles";
import { useWallet } from "@/lib/wallet";
import { cx } from "@/ui/cx";
import { LoadingRegion, SkeletonText } from "@/ui/Skeleton";
import { Page } from "@/ui/Page";
import { NAV, sectionOf } from "./nav";
import { NetworkBadge } from "./NetworkBadge";
import { WalletButton } from "./WalletButton";
import styles from "./AppShell.module.css";

export function AppShell() {
  const { pathname } = useLocation();
  const { address, isCorrectChain } = useWallet();
  const { roles, has } = useRoles();
  const section = sectionOf(pathname);
  const sectionNav = section && has[section] && address && isCorrectChain ? NAV[section] : null;
  const showBottomBar = section === "student" && sectionNav !== null;

  return (
    <div className={cx(styles.shell, showBottomBar && styles.withBottomBar)}>
      <a href="#main" className={styles.skip}>
        Skip to content
      </a>
      <header className={styles.topbar}>
        <div className={styles.topbarInner}>
          <Link to="/" className={styles.wordmark} aria-label="AttendCoin home">
            <span className={styles.mark} aria-hidden="true" />
            <span className="t-display">AttendCoin</span>
          </Link>

          {address && roles.length > 1 && (
            <nav className={styles.roles} aria-label="Role">
              {roles.map((r) => (
                <NavLink
                  key={r}
                  to={homePathFor(r)}
                  className={() => cx(styles.role, section === r && styles.roleActive)}
                  aria-current={section === r ? "page" : undefined}
                >
                  {ROLE_LABEL[r]}
                </NavLink>
              ))}
            </nav>
          )}

          <div className={styles.controls}>
            <NetworkBadge className={styles.network} />
            <WalletButton />
          </div>
        </div>

        {sectionNav && (
          <nav className={styles.subnav} aria-label={`${ROLE_LABEL[section!]} pages`}>
            <div className={styles.subnavInner}>
              {sectionNav.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => cx(styles.subLink, isActive && styles.subLinkActive)}
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          </nav>
        )}
      </header>

      <main id="main" className={styles.main} tabIndex={-1}>
        <Suspense
          fallback={
            <Page>
              <LoadingRegion label="Loading page">
                <SkeletonText lines={4} />
              </LoadingRegion>
            </Page>
          }
        >
          <Outlet />
        </Suspense>
      </main>

      {showBottomBar && (
        <nav className={styles.bottombar} aria-label="Student pages">
          {NAV.student.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => cx(styles.tab, isActive && styles.tabActive)}>
              {Icon && <Icon size={20} strokeWidth={1.75} aria-hidden="true" />}
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
