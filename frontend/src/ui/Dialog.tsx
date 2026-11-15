import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cx } from "./cx";
import styles from "./Dialog.module.css";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Action row, right-aligned on desktop and stacked on phones. Put the primary action last. */
  footer?: ReactNode;
  /** Prevent closing via Escape or backdrop while something is in flight. */
  dismissible?: boolean;
  size?: "sm" | "md";
}

/**
 * Built on the native <dialog> element, so focus trapping, Escape and
 * inertness of the page behind come from the browser.
 */
export function Dialog({ open, onClose, title, description, children, footer, dismissible = true, size = "sm" }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={cx(styles.dialog, styles[size])}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) onClose();
      }}
      onClick={(e) => {
        if (dismissible && e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <div className={styles.inner}>
          <header className={styles.header}>
            <div>
              <h2 id={titleId} className={styles.title}>
                {title}
              </h2>
              {description && (
                <p id={descId} className={styles.description}>
                  {description}
                </p>
              )}
            </div>
            {dismissible && (
              <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
                <X size={18} />
              </button>
            )}
          </header>
          {children && <div className={styles.body}>{children}</div>}
          {footer && <footer className={styles.footer}>{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
