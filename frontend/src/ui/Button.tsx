import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { cx } from "./cx";
import { Spinner } from "./Spinner";
import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  full?: boolean;
  /** Square button for a lone icon. Pass an aria-label. */
  iconOnly?: boolean;
  className?: string;
  children?: ReactNode;
}

export type ButtonProps = CommonProps &
  ButtonHTMLAttributes<HTMLButtonElement> & {
    /** Renders a router link styled as a button. */
    to?: string;
    /** Renders an external link opening in a new tab. */
    href?: string;
  };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    loading = false,
    leading,
    trailing,
    full,
    iconOnly,
    className,
    children,
    to,
    href,
    disabled,
    type = "button",
    ...rest
  },
  ref,
) {
  const classes = cx(
    styles.button,
    styles[variant],
    size !== "md" && styles[size],
    full && styles.full,
    iconOnly && styles.iconOnly,
    loading && styles.loading,
    className,
  );
  const content = (
    <>
      <span className={styles.label}>
        {leading && <span className={styles.icon}>{leading}</span>}
        {children}
        {trailing && <span className={styles.icon}>{trailing}</span>}
      </span>
      {loading && (
        <span className={styles.spinner}>
          <Spinner size={size === "sm" ? 14 : 16} />
        </span>
      )}
    </>
  );

  if (to && !disabled) {
    return (
      <Link to={to} className={classes} aria-label={rest["aria-label"]}>
        {content}
      </Link>
    );
  }
  if (href && !disabled) {
    return (
      <a href={href} className={classes} target="_blank" rel="noreferrer" aria-label={rest["aria-label"]}>
        {content}
      </a>
    );
  }
  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {content}
    </button>
  );
});
