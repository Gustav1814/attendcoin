import type { ReactNode } from "react";
import { cx } from "./cx";
import { Skeleton } from "./Skeleton";
import styles from "./Table.module.css";

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T, index: number) => ReactNode;
  align?: "left" | "right" | "center";
  /** CSS width, e.g. "120px" or "20%". */
  width?: string;
  /** Hide below 720px to keep phone tables readable. */
  hideOnMobile?: boolean;
  /** Use tabular numerals. Defaults to true for right-aligned columns. */
  numeric?: boolean;
}

export interface TableProps<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T, index: number) => string;
  /** Visible caption is optional; an accessible label is not. */
  label: string;
  loading?: boolean;
  skeletonRows?: number;
  /** Rendered in place of the table body when rows is empty. */
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  /** Highlight a row, e.g. the current user's. */
  isRowActive?: (row: T) => boolean;
  className?: string;
}

export function Table<T>({
  columns,
  rows,
  rowKey,
  label,
  loading,
  skeletonRows = 4,
  empty,
  onRowClick,
  isRowActive,
  className,
}: TableProps<T>) {
  if (!loading && rows && rows.length === 0 && empty) return <>{empty}</>;

  const cellClass = (c: Column<T>) =>
    cx(
      styles[c.align ?? "left"],
      (c.numeric ?? c.align === "right") && "t-num",
      c.hideOnMobile && styles.hideOnMobile,
    );

  return (
    <div className={cx(styles.scroll, className)} tabIndex={-1}>
      <table className={styles.table} aria-label={label} aria-busy={loading || undefined}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cellClass(c)} style={{ width: c.width }}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: skeletonRows }, (_, i) => (
                <tr key={`sk-${i}`}>
                  {columns.map((c) => (
                    <td key={c.key} className={cellClass(c)}>
                      <Skeleton width={c.align === "right" ? 56 : "70%"} />
                    </td>
                  ))}
                </tr>
              ))
            : rows?.map((row, i) => (
                <tr
                  key={rowKey(row, i)}
                  className={cx(onRowClick && styles.clickable, isRowActive?.(row) && styles.active)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={cellClass(c)}>
                      {c.render(row, i)}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}
