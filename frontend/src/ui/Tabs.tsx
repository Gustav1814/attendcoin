import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./cx";
import styles from "./Tabs.module.css";

export interface TabItem<V extends string = string> {
  value: V;
  label: ReactNode;
  /** Small count shown after the label. */
  count?: number;
  disabled?: boolean;
}

export interface TabsProps<V extends string> {
  items: TabItem<V>[];
  value: V;
  onChange: (value: V) => void;
  /** Accessible name for the tab list. */
  label: string;
  /** Content of the selected tab. */
  children?: ReactNode;
  className?: string;
}

/** WAI-ARIA tabs with arrow-key navigation and automatic activation. */
export function Tabs<V extends string>({ items, value, onChange, label, children, className }: TabsProps<V>) {
  const baseId = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const enabled = items.filter((i) => !i.disabled);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const current = enabled.findIndex((i) => i.value === value);
    let next = current;
    if (e.key === "ArrowRight") next = (current + 1) % enabled.length;
    else if (e.key === "ArrowLeft") next = (current - 1 + enabled.length) % enabled.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = enabled.length - 1;
    else return;
    e.preventDefault();
    const target = enabled[next];
    onChange(target.value);
    refs.current[items.indexOf(target)]?.focus();
  };

  return (
    <div className={className}>
      <div role="tablist" aria-label={label} className={styles.list} onKeyDown={onKeyDown}>
        {items.map((item, i) => {
          const selected = item.value === value;
          return (
            <button
              key={item.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.value}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel`}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              className={cx(styles.tab, selected && styles.selected)}
              onClick={() => onChange(item.value)}
            >
              {item.label}
              {item.count != null && <span className={cx(styles.count, "t-num")}>{item.count}</span>}
            </button>
          );
        })}
      </div>
      {children != null && (
        <div
          role="tabpanel"
          id={`${baseId}-panel`}
          aria-labelledby={`${baseId}-tab-${value}`}
          className={styles.panel}
          tabIndex={0}
        >
          {children}
        </div>
      )}
    </div>
  );
}
