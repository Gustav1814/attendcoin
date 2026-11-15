import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, CircleAlert, ExternalLink, Info, X } from "lucide-react";
import { cx } from "./cx";
import styles from "./Toast.module.css";

export type ToastTone = "neutral" | "success" | "danger";

export interface ToastInput {
  tone?: ToastTone;
  title: string;
  body?: ReactNode;
  action?: { label: string; href?: string; onClick?: () => void };
  /** Milliseconds; errors stay longer by default. 0 keeps it until dismissed. */
  duration?: number;
}

interface ToastItem extends ToastInput {
  id: number;
}

interface ToastApi {
  push(toast: ToastInput): number;
  dismiss(id: number): void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);
  const push = useCallback((toast: ToastInput) => {
    const id = nextId.current++;
    setItems((list) => [...list.slice(-3), { ...toast, id }]);
    return id;
  }, []);
  const api = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.viewport}>
        <div aria-live="polite" aria-relevant="additions" className={styles.stack}>
          {items
            .filter((t) => t.tone !== "danger")
            .map((t) => (
              <ToastView key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
            ))}
        </div>
        <div role="alert" aria-live="assertive" className={styles.stack}>
          {items
            .filter((t) => t.tone === "danger")
            .map((t) => (
              <ToastView key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
            ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

function ToastView({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const tone = toast.tone ?? "neutral";
  const duration = toast.duration ?? (tone === "danger" ? 9000 : 5000);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!duration || paused) return;
    const id = window.setTimeout(onDismiss, duration);
    return () => window.clearTimeout(id);
  }, [duration, paused, onDismiss]);

  const Icon = tone === "success" ? Check : tone === "danger" ? CircleAlert : Info;
  return (
    <div
      className={cx(styles.toast, styles[tone])}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon className={styles.icon} size={16} aria-hidden="true" />
      <div className={styles.copy}>
        <p className={styles.title}>{toast.title}</p>
        {toast.body && <div className={styles.body}>{toast.body}</div>}
        {toast.action &&
          (toast.action.href ? (
            <a className={styles.action} href={toast.action.href} target="_blank" rel="noreferrer">
              {toast.action.label}
              <ExternalLink size={12} aria-hidden="true" />
            </a>
          ) : (
            <button
              type="button"
              className={styles.action}
              onClick={() => {
                toast.action?.onClick?.();
                onDismiss();
              }}
            >
              {toast.action.label}
            </button>
          ))}
      </div>
      <button type="button" className={styles.close} onClick={onDismiss} aria-label="Dismiss notification">
        <X size={14} />
      </button>
      {duration > 0 && !paused && (
        <span className={styles.timer} style={{ animationDuration: `${duration}ms` }} aria-hidden="true" />
      )}
    </div>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
