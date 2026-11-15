import { useId, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";
import styles from "./Panel.module.css";

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title?: ReactNode;
  description?: ReactNode;
  /** Rendered at the right of the header: buttons, a badge, a link. */
  actions?: ReactNode;
  /** Remove body padding, e.g. for a Table that runs edge to edge. */
  flush?: boolean;
  /** Slightly raised surface for nested or highlighted content. */
  raised?: boolean;
  /** Short accent rule on the top edge, keyed to the colour role of the content. */
  tone?: "mark" | "ink" | "pen";
  children?: ReactNode;
}

/** The base surface. Use one Panel per group of related content; avoid nesting them. */
export function Panel({ title, description, actions, flush, raised, tone, className, children, ...rest }: PanelProps) {
  const headingId = useId();
  const hasHeader = title || description || actions;
  return (
    <section
      className={cx(styles.panel, raised && styles.raised, tone && styles[tone], className)}
      aria-labelledby={title ? headingId : undefined}
      {...rest}
    >
      {hasHeader && (
        <header className={styles.header}>
          <div className={styles.heading}>
            {title && (
              <h2 id={headingId} className={styles.title}>
                {title}
              </h2>
            )}
            {description && <p className={styles.description}>{description}</p>}
          </div>
          {actions && <div className={styles.actions}>{actions}</div>}
        </header>
      )}
      <div className={cx(styles.body, flush && styles.flush, !hasHeader && styles.noHeader)}>{children}</div>
    </section>
  );
}

/** Alias kept for readers who think in cards. */
export const Card = Panel;
