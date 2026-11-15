import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import styles from "./Page.module.css";

export interface PageProps extends HTMLAttributes<HTMLDivElement> {
  /** "narrow" suits single-task screens like check-in. */
  width?: "default" | "narrow";
  children?: ReactNode;
}

/** Content container with the standard gutter and max width. */
export function Page({ width = "default", className, children, ...rest }: PageProps) {
  return (
    <div className={cx(styles.page, width === "narrow" && styles.narrow, className)} {...rest}>
      {children}
    </div>
  );
}

export interface PageHeaderProps {
  title: ReactNode;
  /** Small caps line above the title, e.g. the role or course code. */
  eyebrow?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, eyebrow, description, actions, className }: PageHeaderProps) {
  return (
    <header className={cx(styles.header, className)}>
      <div className={styles.heading}>
        {eyebrow && <p className={cx(styles.eyebrow, "t-caps")}>{eyebrow}</p>}
        <h1 className={cx(styles.title, "t-display")}>{title}</h1>
        {description && <p className={styles.description}>{description}</p>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}

/** Vertical rhythm between sections of a page. */
export function Stack({
  gap = 6,
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { gap?: 2 | 3 | 4 | 6 | 8 }) {
  return (
    <div className={cx(styles.stack, className)} style={{ gap: `var(--space-${gap})` }} {...rest}>
      {children}
    </div>
  );
}

/** Responsive grid: one column on phones, `cols` from 840px. */
export function Grid({
  cols = 2,
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { cols?: 2 | 3 | 4 }) {
  return (
    <div className={cx(styles.grid, styles[`cols${cols}`], className)} {...rest}>
      {children}
    </div>
  );
}
