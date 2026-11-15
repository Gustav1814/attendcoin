import { PackagePlus } from "lucide-react";
import { useMemo, useState } from "react";
import { type ItemView } from "@/lib/contracts";
import { describeError } from "@/lib/errors";
import { formatAtc, formatInteger, parseAtc } from "@/lib/format";
import { Badge } from "@/ui/Badge";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { Field, Input } from "@/ui/Field";
import { Page, PageHeader, Stack } from "@/ui/Page";
import { Panel } from "@/ui/Panel";
import { Table, type Column } from "@/ui/Table";
import { cx } from "@/ui/cx";
import { UNLIMITED_STOCK, useItems, useProtocol } from "./data";
import { TxDialog } from "./TxDialog";
import shared from "./shared.module.css";

type OpenDialog = { kind: "create" } | { kind: "edit"; item: ItemView };

export function AdminCatalogue() {
  const items = useItems();
  const protocol = useProtocol();
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const canManage = protocol.data?.can.manageStore;

  const sorted = useMemo(
    () => items.data && [...items.data].sort((a, b) => Number(b.active) - Number(a.active) || Number(b.id - a.id)),
    [items.data],
  );

  const columns: Column<ItemView>[] = [
    {
      key: "item",
      header: "Item",
      render: (it) => (
        <div className={shared.cell}>
          <span className={shared.primary}>{it.name}</span>
          <span className={cx(shared.secondary, "t-num")}>#{it.id.toString()}</span>
        </div>
      ),
    },
    {
      key: "price",
      header: "Price",
      numeric: true,
      align: "right",
      render: (it) => <span className="t-mark">{formatAtc(it.price)} ATC</span>,
    },
    {
      key: "stock",
      header: "Stock",
      numeric: true,
      align: "right",
      render: (it) =>
        it.stock === UNLIMITED_STOCK ? (
          <span className="t-muted">Unlimited</span>
        ) : it.stock === 0 ? (
          <span className="t-pen">Sold out</span>
        ) : (
          formatInteger(it.stock)
        ),
    },
    {
      key: "limit",
      header: "Per student",
      numeric: true,
      align: "right",
      hideOnMobile: true,
      render: (it) => (it.perStudentLimit === 0 ? <span className="t-muted">No limit</span> : formatInteger(it.perStudentLimit)),
    },
    {
      key: "status",
      header: "Status",
      hideOnMobile: true,
      render: (it) =>
        it.active ? (
          <Badge tone="ink" dot>
            On sale
          </Badge>
        ) : (
          <Badge tone="neutral">Hidden</Badge>
        ),
    },
    {
      key: "actions",
      header: <span className="visually-hidden">Actions</span>,
      align: "right",
      render: (it) => (
        <div className={shared.rowActions}>
          <Button size="sm" variant="ghost" disabled={!canManage} onClick={() => setDialog({ kind: "edit", item: it })}>
            Edit
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Page>
      <PageHeader
        eyebrow="Admin"
        title="Store catalogue"
        description="What students can spend ATC on. Prices are fixed per redemption at the moment a student redeems."
        actions={
          <Button
            variant="primary"
            leading={<PackagePlus size={16} />}
            disabled={!canManage}
            onClick={() => setDialog({ kind: "create" })}
          >
            New item
          </Button>
        }
      />
      <Stack gap={4}>
        {protocol.data && !canManage && (
          <p className={shared.callout} role="note">
            This wallet doesn't hold STORE_MANAGER_ROLE on the store, so it can't add or edit items. The deployer can
            grant it.
          </p>
        )}
        <Panel flush>
          {items.error ? (
            <EmptyState
              tone="danger"
              title="Couldn't load the catalogue"
              body={describeError(items.error).message}
              action={
                <Button variant="secondary" onClick={() => void items.refetch()}>
                  Try again
                </Button>
              }
            />
          ) : (
            <Table
              label="Store items"
              columns={columns}
              rows={sorted}
              rowKey={(it) => it.id.toString()}
              loading={items.isLoading}
              skeletonRows={4}
              empty={
                <EmptyState
                  icon={<PackagePlus size={20} />}
                  title="Nothing for sale yet"
                  body="Add the first item, like a canteen coffee or a print credit, so students have something to spend ATC on."
                  action={
                    canManage && (
                      <Button variant="primary" onClick={() => setDialog({ kind: "create" })}>
                        New item
                      </Button>
                    )
                  }
                />
              }
            />
          )}
        </Panel>
      </Stack>

      {dialog && <ItemDialog item={dialog.kind === "edit" ? dialog.item : null} onClose={() => setDialog(null)} />}
    </Page>
  );
}

function safePrice(value: string): bigint | null {
  const v = value.trim();
  if (!v || !/^\d*\.?\d*$/.test(v) || v === ".") return null;
  try {
    return parseAtc(v);
  } catch {
    return null;
  }
}

function wholeNumber(value: string, max: number): number | null {
  const v = value.trim();
  if (!/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n <= max ? n : null;
}

const plainAtc = (wei: bigint) => formatAtc(wei, { maxFractionDigits: 18 }).replace(/,/g, "");

function ItemDialog({ item, onClose }: { item: ItemView | null; onClose: () => void }) {
  const editing = item != null;
  const [name, setName] = useState(item?.name ?? "");
  const [price, setPrice] = useState(item ? plainAtc(item.price) : "");
  const [unlimitedStock, setUnlimitedStock] = useState(item ? item.stock === UNLIMITED_STOCK : false);
  const [stock, setStock] = useState(item && item.stock !== UNLIMITED_STOCK ? String(item.stock) : "");
  const [noLimit, setNoLimit] = useState(item ? item.perStudentLimit === 0 : false);
  const [limit, setLimit] = useState(item && item.perStudentLimit ? String(item.perStudentLimit) : "1");
  const [active, setActive] = useState(item?.active ?? true);
  const [touched, setTouched] = useState(false);

  const trimmed = name.trim();
  const nameBytes = new TextEncoder().encode(trimmed).length;
  const p = safePrice(price);
  // UNLIMITED_STOCK itself is reserved for "unlimited", so a counted stock stops one below it.
  const s = unlimitedStock ? UNLIMITED_STOCK : wholeNumber(stock, UNLIMITED_STOCK - 1);
  const l = noLimit ? 0 : wholeNumber(limit, UNLIMITED_STOCK);

  const nameError = editing
    ? null
    : touched && !trimmed
      ? "Give the item a name."
      : nameBytes > 64
        ? "Names are at most 64 bytes."
        : null;
  const priceError = (touched || price) && (p == null || p === 0n) ? "Enter a price above zero, e.g. 25." : null;
  const stockError = (touched || stock) && s == null ? "A whole number, or tick unlimited." : null;
  const limitError = !noLimit && (l == null || l === 0) ? "At least 1, or tick no limit." : null;
  const valid = (editing || (trimmed && nameBytes <= 64)) && p != null && p > 0n && s != null && l != null && (noLimit || l > 0);
  const changed =
    !editing ||
    p !== item.price ||
    s !== item.stock ||
    l !== item.perStudentLimit ||
    active !== item.active;

  return (
    <TxDialog
      title={editing ? `Edit ${item.name}` : "New store item"}
      doneTitle={editing ? `${item.name} updated` : `${trimmed} added`}
      description={
        editing
          ? "Changes apply to new redemptions. Anything already redeemed keeps the price the student paid."
          : "It goes on sale as soon as the transaction confirms."
      }
      doneDescription={
        editing
          ? active
            ? "Students see the new details on their next refresh."
            : "It's hidden from the store. Pending redemptions can still be fulfilled."
          : "Students can redeem it from the Store page now."
      }
      confirmLabel={editing ? "Save item" : "Add item"}
      txLabel={editing ? `Update ${item.name}` : `Add ${trimmed}`}
      disabled={!valid || !changed}
      send={({ contracts }) =>
        editing
          ? contracts.store.updateItem(item.id, p!, s!, l!, active)
          : contracts.store.createItem(trimmed, "", p!, s!, l!)
      }
      onClose={onClose}
    >
      <form
        className={shared.form}
        onSubmit={(e) => e.preventDefault()}
        onBlur={() => setTouched(true)}
      >
        <Field
          label="Name"
          error={nameError}
          hint={editing ? "Names are fixed once an item is created." : "Shown to students, e.g. Canteen coffee."}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} readOnly={editing} maxLength={64} autoFocus={!editing} />
        </Field>
        <Field label="Price" error={priceError}>
          <Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} suffix="ATC" autoFocus={editing} />
        </Field>
        <div className={shared.pair}>
          <Field
            label="Stock"
            error={unlimitedStock ? null : stockError}
            aside={
              <label className={shared.check}>
                <input type="checkbox" checked={unlimitedStock} onChange={(e) => setUnlimitedStock(e.target.checked)} />
                Unlimited
              </label>
            }
          >
            <Input
              inputMode="numeric"
              value={unlimitedStock ? "" : stock}
              placeholder={unlimitedStock ? "Unlimited" : "50"}
              disabled={unlimitedStock}
              onChange={(e) => setStock(e.target.value)}
            />
          </Field>
          <Field
            label="Per student"
            error={noLimit ? null : limitError}
            aside={
              <label className={shared.check}>
                <input type="checkbox" checked={noLimit} onChange={(e) => setNoLimit(e.target.checked)} />
                No limit
              </label>
            }
          >
            <Input
              inputMode="numeric"
              value={noLimit ? "" : limit}
              placeholder={noLimit ? "No limit" : "1"}
              disabled={noLimit}
              onChange={(e) => setLimit(e.target.value)}
            />
          </Field>
        </div>
        {editing && (
          <label className={shared.check}>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span>
              <strong>On sale.</strong> Untick to hide it from students without losing its history.
            </span>
          </label>
        )}
      </form>
    </TxDialog>
  );
}
