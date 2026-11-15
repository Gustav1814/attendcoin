import { getAddress } from "ethers";
import { FileUp, Search, UserPlus } from "lucide-react";
import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { describeError } from "@/lib/errors";
import { formatAtc, formatDate, formatInteger, pluralize } from "@/lib/format";
import { TEACHER_ROLE, VENDOR_ROLE } from "@/lib/roles";
import { useTx } from "@/lib/tx";
import { useContracts, useWallet } from "@/lib/wallet";
import { AddressChip } from "@/ui/AddressChip";
import { Badge } from "@/ui/Badge";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { EmptyState } from "@/ui/EmptyState";
import { Field, Input, Textarea } from "@/ui/Field";
import { Page, PageHeader } from "@/ui/Page";
import { Panel } from "@/ui/Panel";
import { Table, type Column } from "@/ui/Table";
import { Tabs } from "@/ui/Tabs";
import { TxStatus } from "@/ui/TxStatus";
import { cx } from "@/ui/cx";
import {
  addressError,
  MAX_BATCH,
  useCourses,
  useProtocol,
  useRoleHolders,
  useStudents,
  useWalletCheck,
  type AdminCourse,
  type RoleHolder,
  type StudentRow,
} from "./data";
import { Steps } from "./Steps";
import { TxDialog } from "./TxDialog";
import shared from "./shared.module.css";
import styles from "./People.module.css";

type Tab = "students" | "teachers" | "vendors";
type RoleKind = "teacher" | "vendor";

type OpenDialog =
  | { kind: "register" }
  | { kind: "import" }
  | { kind: "status"; student: StudentRow }
  | { kind: "relink"; student: StudentRow }
  | { kind: "grant"; role: RoleKind }
  | { kind: "revoke"; role: RoleKind; holder: RoleHolder };

const TABS: Tab[] = ["students", "teachers", "vendors"];

export function AdminPeople() {
  const [params, setParams] = useSearchParams();
  const tabParam = params.get("tab") as Tab | null;
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : "students";
  const [dialog, setDialog] = useState<OpenDialog | null>(() =>
    params.get("register") ? { kind: "register" } : null,
  );

  const students = useStudents();
  const teachers = useRoleHolders("teacher");
  const vendors = useRoleHolders("vendor");
  const courses = useCourses();

  const setTab = (next: Tab) =>
    setParams(
      (p) => {
        p.delete("register");
        if (next === "students") p.delete("tab");
        else p.set("tab", next);
        return p;
      },
      { replace: true },
    );

  const close = () => {
    setDialog(null);
    if (params.has("register")) {
      setParams(
        (p) => {
          p.delete("register");
          return p;
        },
        { replace: true },
      );
    }
  };

  const actions =
    tab === "students" ? (
      <>
        <Button variant="secondary" leading={<FileUp size={16} />} onClick={() => setDialog({ kind: "import" })}>
          Import CSV
        </Button>
        <Button variant="primary" leading={<UserPlus size={16} />} onClick={() => setDialog({ kind: "register" })}>
          Register student
        </Button>
      </>
    ) : (
      <Button variant="primary" onClick={() => setDialog({ kind: "grant", role: tab === "teachers" ? "teacher" : "vendor" })}>
        {tab === "teachers" ? "Add teacher" : "Add vendor"}
      </Button>
    );

  return (
    <Page>
      <PageHeader
        eyebrow="Admin"
        title="People"
        description="Students are registered on-chain against a directory profile. Teachers and vendors are wallet roles."
        actions={actions}
      />

      <Tabs
        label="People"
        value={tab}
        onChange={setTab}
        items={[
          { value: "students", label: "Students", count: students.data?.students.length },
          { value: "teachers", label: "Teachers", count: teachers.data?.length },
          { value: "vendors", label: "Vendors", count: vendors.data?.length },
        ]}
      >
        {tab === "students" ? (
          <StudentsPanel
            query={students}
            courses={courses.data}
            onRegister={() => setDialog({ kind: "register" })}
            onImport={() => setDialog({ kind: "import" })}
            onStatus={(student) => setDialog({ kind: "status", student })}
            onRelink={(student) => setDialog({ kind: "relink", student })}
          />
        ) : (
          <RolePanel
            kind={tab === "teachers" ? "teacher" : "vendor"}
            query={tab === "teachers" ? teachers : vendors}
            courses={courses.data}
            onGrant={(role) => setDialog({ kind: "grant", role })}
            onRevoke={(role, holder) => setDialog({ kind: "revoke", role, holder })}
          />
        )}
      </Tabs>

      {dialog?.kind === "register" && <RegisterDialog onClose={close} />}
      {dialog?.kind === "import" && <ImportDialog onClose={close} />}
      {dialog?.kind === "status" && <StatusDialog student={dialog.student} onClose={close} />}
      {dialog?.kind === "relink" && <RelinkDialog student={dialog.student} onClose={close} />}
      {dialog?.kind === "grant" && (
        <GrantDialog role={dialog.role} holders={(dialog.role === "teacher" ? teachers : vendors).data} onClose={close} />
      )}
      {dialog?.kind === "revoke" && (
        <RevokeDialog role={dialog.role} holder={dialog.holder} courses={courses.data} onClose={close} />
      )}
    </Page>
  );
}

function courseCodes(ids: bigint[], courses: AdminCourse[] | undefined): string[] {
  if (!courses) return [];
  return ids.map((id) => courses.find((c) => c.id === id)?.code ?? `#${id}`);
}

function StudentsPanel({
  query,
  courses,
  onRegister,
  onImport,
  onStatus,
  onRelink,
}: {
  query: ReturnType<typeof useStudents>;
  courses: AdminCourse[] | undefined;
  onRegister: () => void;
  onImport: () => void;
  onStatus: (s: StudentRow) => void;
  onRelink: (s: StudentRow) => void;
}) {
  const [search, setSearch] = useState("");
  const all = query.data?.students;

  const rows = useMemo(() => {
    if (!all) return undefined;
    const q = search.trim().toLowerCase().replace(/^#/, "");
    const sorted = [...all].sort((a, b) => Number(b.id - a.id));
    if (!q) return sorted;
    return sorted.filter(
      (s) =>
        s.id.toString() === q ||
        s.wallet.toLowerCase().includes(q) ||
        s.name?.toLowerCase().includes(q) ||
        courseCodes(s.courses, courses).some((c) => c.toLowerCase().includes(q)),
    );
  }, [all, search, courses]);

  if (query.error) {
    return (
      <Panel>
        <EmptyState
          tone="danger"
          title="Couldn't load students"
          body={describeError(query.error).message}
          action={
            <Button variant="secondary" onClick={() => void query.refetch()}>
              Try again
            </Button>
          }
        />
      </Panel>
    );
  }

  const columns: Column<StudentRow>[] = [
    {
      key: "student",
      header: "Student",
      render: (s) => (
        <div className={shared.cell}>
          <span className={cx(shared.primary, !s.name && shared.missing)}>{s.name ?? "No profile"}</span>
          <span className={cx(shared.secondary, "t-num")}>#{s.id.toString()}</span>
        </div>
      ),
    },
    { key: "wallet", header: "Wallet", render: (s) => <AddressChip address={s.wallet} explorer />, hideOnMobile: true },
    {
      key: "courses",
      header: "Courses",
      hideOnMobile: true,
      render: (s) => {
        const codes = courseCodes(s.courses, courses);
        if (codes.length === 0) return <span className={shared.missing}>None</span>;
        const shown = codes.slice(0, 3).join(", ");
        return (
          <span title={codes.join(", ")}>
            {shown}
            {codes.length > 3 && <span className="t-muted"> +{codes.length - 3}</span>}
          </span>
        );
      },
    },
    {
      key: "balance",
      header: "Balance",
      numeric: true,
      align: "right",
      render: (s) => <span className="t-mark">{formatAtc(s.balance)}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (s) =>
        s.active ? (
          <Badge tone="ink" dot>
            Active
          </Badge>
        ) : (
          <Badge tone="pen" dot>
            Inactive
          </Badge>
        ),
    },
    {
      key: "actions",
      header: <span className="visually-hidden">Actions</span>,
      align: "right",
      render: (s) => (
        <div className={shared.rowActions}>
          <Button size="sm" variant="ghost" onClick={() => onRelink(s)}>
            Re-link
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onStatus(s)}>
            {s.active ? "Deactivate" : "Activate"}
          </Button>
        </div>
      ),
    },
  ];

  const total = all?.length ?? 0;

  return (
    <Panel flush>
      {total > 0 && (
        <div className={cx(shared.toolbar, styles.toolbarTop)}>
          <Input
            className={shared.search}
            type="search"
            placeholder="Name, wallet, #id or course"
            aria-label="Search students"
            prefix={<Search size={14} />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <p className={shared.toolbarNote} aria-live="polite">
            {query.data?.namesOffline
              ? "Names unavailable: the profile server didn't respond."
              : search && rows
                ? `${formatInteger(rows.length)} of ${formatInteger(total)}`
                : pluralize(total, "student")}
          </p>
        </div>
      )}
      <Table
        label="Students"
        columns={columns}
        rows={rows}
        rowKey={(s) => s.id.toString()}
        loading={query.isLoading}
        skeletonRows={6}
        empty={
          total === 0 ? (
            <EmptyState
              icon={<UserPlus size={20} />}
              title="No students yet"
              body="Register students one at a time, or import a CSV of wallets, names and roll numbers."
              action={
                <>
                  <Button variant="secondary" onClick={onImport}>
                    Import CSV
                  </Button>
                  <Button variant="primary" onClick={onRegister}>
                    Register student
                  </Button>
                </>
              }
            />
          ) : (
            <EmptyState
              compact
              title={`No students match "${search.trim()}"`}
              body="Search by name, wallet address, student number or course code."
              action={
                <Button size="sm" variant="secondary" onClick={() => setSearch("")}>
                  Clear search
                </Button>
              }
            />
          )
        }
      />
    </Panel>
  );
}

function RolePanel({
  kind,
  query,
  courses,
  onGrant,
  onRevoke,
}: {
  kind: RoleKind;
  query: ReturnType<typeof useRoleHolders>;
  courses: AdminCourse[] | undefined;
  onGrant: (role: RoleKind) => void;
  onRevoke: (role: RoleKind, holder: RoleHolder) => void;
}) {
  const noun = kind === "teacher" ? "teacher" : "vendor";

  if (query.error) {
    return (
      <Panel>
        <EmptyState
          tone="danger"
          title={`Couldn't load ${noun}s`}
          body="Role holders are read from contract events. The node may have refused the range; try again."
          action={
            <Button variant="secondary" onClick={() => void query.refetch()}>
              Try again
            </Button>
          }
        />
      </Panel>
    );
  }

  const columns: Column<RoleHolder>[] = [
    {
      key: "account",
      header: kind === "teacher" ? "Teacher" : "Vendor",
      render: (h) => <AddressChip address={h.account} name={h.name} explorer />,
    },
    ...(kind === "teacher"
      ? [
          {
            key: "courses",
            header: "Courses",
            hideOnMobile: true,
            render: (h: RoleHolder) => {
              const taught = courses?.filter((c) => c.teacher.toLowerCase() === h.account.toLowerCase()) ?? [];
              return taught.length ? (
                taught.map((c) => c.code).join(", ")
              ) : (
                <span className={shared.missing}>None assigned</span>
              );
            },
          },
        ]
      : []),
    {
      key: "since",
      header: "Since",
      hideOnMobile: true,
      render: (h) => <span className="t-num">{h.since ? formatDate(h.since) : "—"}</span>,
    },
    {
      key: "actions",
      header: <span className="visually-hidden">Actions</span>,
      align: "right",
      render: (h) => (
        <div className={shared.rowActions}>
          <Button size="sm" variant="ghost" onClick={() => onRevoke(kind, h)}>
            Remove
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Panel flush>
      <Table
        label={`${noun}s`}
        columns={columns}
        rows={query.data}
        rowKey={(h) => h.account}
        loading={query.isLoading}
        skeletonRows={3}
        empty={
          <EmptyState
            title={`No ${noun}s yet`}
            body={
              kind === "teacher"
                ? "Teachers open sessions and mark attendance. Add one before creating a course."
                : "Vendors fulfil redemptions at the counter. Add the wallet the counter tablet uses."
            }
            action={
              <Button variant="primary" onClick={() => onGrant(kind)}>
                Add {noun}
              </Button>
            }
          />
        }
      />
    </Panel>
  );
}

function profileProblem(err: unknown, rollNumber: string): string {
  if (err instanceof ApiError) {
    if (err.status === 409) return `Roll number ${rollNumber} is already linked to a different wallet in the directory.`;
    if (err.isNetwork) return "The profile server didn't respond. Check that the backend is running, then try again.";
    if (err.status === 401 || err.status === 403)
      return "The profile server didn't accept your admin signature. Make sure this wallet is the deployment admin.";
  }
  return describeError(err).message;
}

type RegisterStep = "form" | "profile" | "chain" | "done";

function RegisterDialog({ onClose }: { onClose: () => void }) {
  const { signer } = useWallet();
  const { read } = useContracts();
  const tx = useTx();
  const [form, setForm] = useState({ wallet: "", name: "", rollNumber: "", email: "" });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [step, setStep] = useState<RegisterStep>("form");
  const [problem, setProblem] = useState<string | null>(null);
  const [studentId, setStudentId] = useState<bigint | null>(null);

  const wallet = form.wallet.trim();
  const check = useWalletCheck(wallet);
  const name = form.name.trim();
  const roll = form.rollNumber.trim();
  const email = form.email.trim();

  const walletError =
    (touched.wallet || wallet.length >= 42) && addressError(wallet)
      ? addressError(wallet)
      : check.data?.studentId
        ? `Already registered as student #${check.data.studentId}.`
        : check.data?.teacher
          ? "This wallet is a teacher. A wallet can't be both a teacher and a student."
          : null;
  const nameError = touched.name && !name ? "Enter the student's name." : name.length > 100 ? "Keep it under 100 characters." : null;
  const rollError =
    touched.rollNumber && !roll ? "Enter a roll number." : roll.length > 64 ? "Keep it under 64 characters." : null;
  const emailError = email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? "That doesn't look like an email address." : null;

  const ready =
    !addressError(wallet) &&
    check.isSuccess &&
    !check.data.studentId &&
    !check.data.teacher &&
    name.length > 0 &&
    name.length <= 100 &&
    roll.length > 0 &&
    roll.length <= 64 &&
    !emailError;
  const working = step === "profile" || tx.busy;

  const submit = async () => {
    if (!signer || !read || !ready) return;
    setProblem(null);
    setStep("profile");
    const target = getAddress(wallet);
    let idHash: string;
    try {
      // The directory upserts by wallet, so re-running after a failed transaction is safe.
      const profile = await api.admin.createProfile(signer, {
        wallet: target,
        name,
        rollNumber: roll,
        email: email || undefined,
      });
      idHash = profile.idHash;
      if (await read.manager.idHashUsed(idHash)) {
        setProblem(
          `Roll number ${roll} is already registered on-chain. If the student lost their wallet, re-link them instead.`,
        );
        setStep("form");
        return;
      }
    } catch (err) {
      setProblem(profileProblem(err, roll));
      setStep("form");
      return;
    }
    setStep("chain");
    const id = await tx.run({
      label: `Register ${name}`,
      quiet: true,
      send: ({ contracts }) => contracts.manager.registerStudent(target, idHash),
      onConfirmed: () => read.manager.studentIdOf(target),
    });
    if (id === undefined) return;
    setStudentId(id);
    setStep("done");
  };

  const reset = () => {
    setForm({ wallet: "", name: "", rollNumber: "", email: "" });
    setTouched({});
    setStudentId(null);
    setStep("form");
    tx.reset();
  };

  const set = (key: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  const blur = (key: keyof typeof form) => () => setTouched((t) => ({ ...t, [key]: true }));

  const done = step === "done";

  return (
    <Dialog
      open
      size="md"
      onClose={() => !working && onClose()}
      dismissible={!working}
      title={done ? "Student registered" : "Register a student"}
      description={
        done
          ? `${name} is student #${studentId}. They can connect ${wallet.slice(0, 6)}… and start earning ATC once enrolled in a course.`
          : "Saves the profile to the directory, then records the wallet on-chain. You'll sign twice: once for the directory, once for the transaction."
      }
      footer={
        done ? (
          <>
            <Button variant="ghost" onClick={reset}>
              Register another
            </Button>
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={working}>
              Cancel
            </Button>
            <Button variant="primary" loading={working} disabled={!ready} onClick={() => void submit()}>
              {tx.state.phase === "failed" ? "Try again" : "Register"}
            </Button>
          </>
        )
      }
    >
      <div className={shared.dialogBody}>
        {step !== "form" && (
          <Steps steps={["Save profile", "Register on-chain"]} active={done ? 2 : step === "profile" ? 0 : 1} working={working} />
        )}
        {!done && (
          <form
            className={shared.form}
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <fieldset disabled={working} className={styles.fieldset}>
              <Field label="Wallet address" error={walletError} hint={check.isFetching ? "Checking the wallet…" : undefined}>
                <Input
                  mono
                  value={form.wallet}
                  onChange={set("wallet")}
                  onBlur={blur("wallet")}
                  placeholder="0x…"
                  autoComplete="off"
                  spellCheck={false}
                  autoFocus
                />
              </Field>
              <div className={shared.pair}>
                <Field label="Full name" error={nameError}>
                  <Input value={form.name} onChange={set("name")} onBlur={blur("name")} maxLength={100} autoComplete="off" />
                </Field>
                <Field label="Roll number" error={rollError} hint="Hashed on-chain; the number itself stays off-chain.">
                  <Input
                    value={form.rollNumber}
                    onChange={set("rollNumber")}
                    onBlur={blur("rollNumber")}
                    maxLength={64}
                    autoComplete="off"
                  />
                </Field>
              </div>
              <Field label="Email" optional error={emailError}>
                <Input type="email" value={form.email} onChange={set("email")} autoComplete="off" />
              </Field>
            </fieldset>
            <button type="submit" hidden />
          </form>
        )}
        {problem && (
          <p className={cx(shared.callout, shared.danger)} role="alert">
            {problem}
          </p>
        )}
        <TxStatus state={tx.state} />
      </div>
    </Dialog>
  );
}

interface ImportRow {
  line: number;
  wallet: string;
  name: string;
  rollNumber: string;
  email: string;
  status: "ready" | "invalid" | "skipped" | "saved" | "registered" | "failed";
  problem: string | null;
  idHash?: string;
}

/** RFC 4180 enough for spreadsheet exports: quoted fields, doubled quotes, CRLF. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((r) => r.map((f) => f.trim()));
}

function rowsFromCsv(text: string): ImportRow[] {
  const parsed = parseCsv(text);
  const seenWallets = new Set<string>();
  const seenRolls = new Set<string>();
  const out: ImportRow[] = [];
  parsed.forEach((cells, i) => {
    if (cells.every((c) => !c)) return;
    if (i === 0 && /wallet|address/i.test(cells[0] ?? "")) return;
    const [wallet = "", name = "", rollNumber = "", email = ""] = cells;
    const row: ImportRow = { line: i + 1, wallet, name, rollNumber, email, status: "ready", problem: null };
    const walletProblem = addressError(wallet);
    if (walletProblem) row.problem = "Invalid wallet address";
    else if (!name) row.problem = "Missing name";
    else if (name.length > 100) row.problem = "Name over 100 characters";
    else if (!rollNumber) row.problem = "Missing roll number";
    else if (rollNumber.length > 64) row.problem = "Roll number over 64 characters";
    else if (seenWallets.has(wallet.toLowerCase())) row.problem = "Wallet repeated in this file";
    else if (seenRolls.has(rollNumber.toLowerCase())) row.problem = "Roll number repeated in this file";
    if (!walletProblem) {
      row.wallet = getAddress(wallet);
      seenWallets.add(wallet.toLowerCase());
    }
    if (rollNumber) seenRolls.add(rollNumber.toLowerCase());
    if (row.problem) row.status = "invalid";
    out.push(row);
  });
  return out;
}

const STATUS_BADGE: Record<ImportRow["status"], { tone: "neutral" | "mark" | "ink" | "pen"; label: string }> = {
  ready: { tone: "neutral", label: "Ready" },
  invalid: { tone: "pen", label: "Fix" },
  skipped: { tone: "neutral", label: "Skipped" },
  saved: { tone: "mark", label: "Profile saved" },
  registered: { tone: "ink", label: "Registered" },
  failed: { tone: "pen", label: "Failed" },
};

type ImportPhase = "input" | "checking" | "preview" | "profiles" | "chain" | "done";

function ImportDialog({ onClose }: { onClose: () => void }) {
  const { signer } = useWallet();
  const { read } = useContracts();
  const tx = useTx();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [phase, setPhase] = useState<ImportPhase>("input");
  const [problem, setProblem] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const counts = useMemo(() => {
    const c = { ready: 0, invalid: 0, skipped: 0, saved: 0, registered: 0, failed: 0 };
    for (const r of rows) c[r.status]++;
    return c;
  }, [rows]);

  const loadFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setText(await file.text());
  };

  const preview = async () => {
    if (!read) return;
    setProblem(null);
    const parsed = rowsFromCsv(text);
    if (parsed.length === 0) {
      setProblem("No rows found. Each line needs wallet, name and roll number, separated by commas.");
      return;
    }
    setPhase("checking");
    try {
      const checks = await Promise.all(
        parsed.map((r) =>
          r.status === "ready"
            ? Promise.all([read.manager.studentIdOf(r.wallet), read.manager.hasRole(TEACHER_ROLE, r.wallet)])
            : null,
        ),
      );
      parsed.forEach((r, i) => {
        const c = checks[i];
        if (!c) return;
        if (c[0] !== 0n) {
          r.status = "skipped";
          r.problem = `Already student #${c[0]}`;
        } else if (c[1]) {
          r.status = "invalid";
          r.problem = "Wallet is a teacher";
        }
      });
      setRows(parsed);
      setPhase("preview");
    } catch (err) {
      setProblem(describeError(err).message);
      setPhase("input");
    }
  };

  const update = (next: ImportRow[]) => setRows(next.map((r) => ({ ...r })));

  const run = async () => {
    if (!signer || !read) return;
    setProblem(null);
    const work = rows.map((r) => ({ ...r }));

    const toSave = work.filter((r) => r.status === "ready");
    if (toSave.length) {
      setPhase("profiles");
      setProgress({ done: 0, total: toSave.length });
      for (const [i, r] of toSave.entries()) {
        try {
          const res = await api.admin.createProfile(signer, {
            wallet: r.wallet,
            name: r.name,
            rollNumber: r.rollNumber,
            email: r.email || undefined,
          });
          if (await read.manager.idHashUsed(res.idHash)) {
            r.status = "failed";
            r.problem = "Roll number already registered on-chain";
          } else {
            r.status = "saved";
            r.idHash = res.idHash;
          }
        } catch (err) {
          // A per-row conflict is the row's problem; anything else would fail every remaining row too.
          if (err instanceof ApiError && err.status === 409) {
            r.status = "failed";
            r.problem = "Roll number linked to another wallet";
          } else {
            update(work);
            setProblem(profileProblem(err, r.rollNumber));
            setPhase("preview");
            return;
          }
        }
        setProgress({ done: i + 1, total: toSave.length });
        update(work);
      }
    }

    const toRegister = work.filter((r) => r.status === "saved" && r.idHash);
    if (toRegister.length) {
      setPhase("chain");
      const batches = Math.ceil(toRegister.length / MAX_BATCH);
      for (let b = 0; b < batches; b++) {
        const chunk = toRegister.slice(b * MAX_BATCH, (b + 1) * MAX_BATCH);
        setProgress({ done: b, total: batches });
        const ok = await tx.run({
          label: batches > 1 ? `Register batch ${b + 1} of ${batches}` : `Register ${pluralize(chunk.length, "student")}`,
          quiet: true,
          send: ({ contracts }) =>
            contracts.manager.registerStudents(
              chunk.map((r) => r.wallet),
              chunk.map((r) => r.idHash!),
            ),
          onConfirmed: () => true,
        });
        if (!ok) {
          setPhase("preview");
          return;
        }
        for (const r of chunk) r.status = "registered";
        update(work);
      }
    }
    setProgress((p) => ({ ...p, done: p.total }));
    setPhase("done");
  };

  const working = phase === "checking" || phase === "profiles" || phase === "chain";
  const pending = counts.ready + counts.saved;
  const stepIndex = phase === "profiles" ? 0 : phase === "chain" ? 1 : phase === "done" ? 2 : -1;

  return (
    <Dialog
      open
      size="md"
      onClose={() => !working && onClose()}
      dismissible={!working}
      title={phase === "done" ? "Import finished" : "Import students"}
      description={
        phase === "done"
          ? `${pluralize(counts.registered, "student")} registered.${
              counts.failed + counts.invalid + counts.skipped > 0
                ? ` ${formatInteger(counts.failed + counts.invalid + counts.skipped)} rows were left out; they're listed below.`
                : ""
            }`
          : phase === "input" || phase === "checking"
            ? "One student per line: wallet, name, roll number, and optionally email. A header row is fine."
            : "Profiles are saved to the directory first (one signature), then wallets are registered on-chain in batches of up to 100."
      }
      footer={
        phase === "input" || phase === "checking" ? (
          <>
            <Button variant="ghost" onClick={onClose} disabled={working}>
              Cancel
            </Button>
            <Button variant="primary" loading={working} disabled={!text.trim()} onClick={() => void preview()}>
              Check rows
            </Button>
          </>
        ) : phase === "done" ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button
              variant="ghost"
              disabled={working}
              onClick={() => {
                setPhase("input");
                setRows([]);
                tx.reset();
              }}
            >
              Edit list
            </Button>
            <Button variant="primary" loading={working} disabled={pending === 0} onClick={() => void run()}>
              {tx.state.phase === "failed" || counts.saved > 0 ? "Continue import" : `Import ${pluralize(pending, "student")}`}
            </Button>
          </>
        )
      }
    >
      <div className={shared.dialogBody}>
        {phase === "input" || phase === "checking" ? (
          <>
            <Field
              label="CSV"
              aside={
                <Button size="sm" variant="ghost" leading={<FileUp size={14} />} onClick={() => fileRef.current?.click()}>
                  Choose file
                </Button>
              }
            >
              <Textarea
                mono
                rows={8}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={"wallet,name,rollNumber,email\n0x8a1f…,Asha Rao,CS-2024-031,asha@campus.edu"}
                spellCheck={false}
                disabled={working}
              />
            </Field>
            <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" hidden onChange={(e) => void loadFile(e)} />
          </>
        ) : (
          <>
            {stepIndex >= 0 && (
              <div className={styles.progressRow}>
                <Steps steps={["Save profiles", "Register on-chain"]} active={stepIndex} working={working} />
                {working && progress.total > 1 && (
                  <span className={cx(shared.toolbarNote, "t-num")} aria-live="polite">
                    {phase === "profiles" ? `${progress.done} of ${progress.total} profiles` : `Batch ${progress.done + 1} of ${progress.total}`}
                  </span>
                )}
              </div>
            )}
            <p className={shared.note}>
              <strong className="t-num">{formatInteger(pending)}</strong> to import
              {counts.registered > 0 && (
                <>
                  {" · "}
                  <span className="t-num">{formatInteger(counts.registered)}</span> registered
                </>
              )}
              {counts.skipped > 0 && (
                <>
                  {" · "}
                  <span className="t-num">{formatInteger(counts.skipped)}</span> already registered
                </>
              )}
              {counts.invalid + counts.failed > 0 && (
                <>
                  {" · "}
                  <span className="t-pen t-num">{formatInteger(counts.invalid + counts.failed)}</span> need attention
                </>
              )}
            </p>
            <ol className={styles.preview} aria-label="Rows">
              {rows.map((r) => {
                const badge = STATUS_BADGE[r.status];
                return (
                  <li key={r.line} className={styles.previewRow}>
                    <span className={cx(styles.line, "t-num")}>{r.line}</span>
                    <span className={shared.cell}>
                      <span className={shared.primary}>{r.name || <span className={shared.missing}>No name</span>}</span>
                      <span className={cx(shared.secondary, "t-mono")}>
                        {r.rollNumber || "—"} · {r.wallet ? `${r.wallet.slice(0, 6)}…${r.wallet.slice(-4)}` : "no wallet"}
                      </span>
                    </span>
                    <span className={styles.rowStatus}>
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                      {r.problem && <span className={styles.rowProblem}>{r.problem}</span>}
                    </span>
                  </li>
                );
              })}
            </ol>
          </>
        )}
        {problem && (
          <p className={cx(shared.callout, shared.danger)} role="alert">
            {problem}
          </p>
        )}
        <TxStatus state={tx.state} />
      </div>
    </Dialog>
  );
}

function StatusDialog({ student, onClose }: { student: StudentRow; onClose: () => void }) {
  const who = student.name ?? `Student #${student.id}`;
  const deactivate = student.active;
  return (
    <TxDialog
      title={deactivate ? `Deactivate ${who}?` : `Reactivate ${who}?`}
      doneTitle={deactivate ? `${who} is inactive` : `${who} is active again`}
      description={
        deactivate
          ? "They stop earning ATC for attendance and are removed from the campus wallet allowlist, so they can't send or receive ATC while transfers are restricted. Their balance and history stay."
          : "They can check in and earn ATC again, and their wallet is added back to the campus allowlist."
      }
      doneDescription={
        deactivate ? "You can reactivate them at any time." : "Their next check-in will earn ATC as normal."
      }
      confirmLabel={deactivate ? "Deactivate" : "Reactivate"}
      tone={deactivate ? "danger" : "primary"}
      txLabel={`${deactivate ? "Deactivate" : "Reactivate"} ${who}`}
      send={({ contracts }) => contracts.manager.setStudentActive(student.id, !deactivate)}
      onClose={onClose}
    >
      <dl className={shared.summary}>
        <div>
          <dt>Wallet</dt>
          <dd>
            <AddressChip address={student.wallet} />
          </dd>
        </div>
        <div>
          <dt>Balance</dt>
          <dd className="t-num t-mark">{formatAtc(student.balance)} ATC</dd>
        </div>
      </dl>
    </TxDialog>
  );
}

function RelinkDialog({ student, onClose }: { student: StudentRow; onClose: () => void }) {
  const protocol = useProtocol();
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const target = value.trim();
  const check = useWalletCheck(target);
  const format = addressError(target);
  const same = !format && target.toLowerCase() === student.wallet.toLowerCase();
  const error =
    (touched || target.length >= 42) && format
      ? format
      : same
        ? "That's the wallet they already use."
        : check.data?.studentId
          ? `That wallet already belongs to student #${check.data.studentId}.`
          : check.data?.teacher
            ? "That wallet is a teacher, so it can't be a student."
            : null;
  const paused = protocol.data?.paused.token;
  const ready = !format && !same && check.isSuccess && !check.data.studentId && !check.data.teacher && !paused;
  const who = student.name ?? `Student #${student.id}`;

  return (
    <TxDialog
      title={`Move ${who} to a new wallet`}
      doneTitle="Wallet re-linked"
      description="Use this when a student has lost access to their wallet. Only the student should give you the new address."
      doneDescription={`${who} now signs in with ${target.slice(0, 6)}…${target.slice(-4)}. The old wallet can no longer check in or hold ATC on campus.`}
      confirmLabel="Move wallet and balance"
      tone="danger"
      txLabel={`Re-link ${who}`}
      disabled={!ready}
      send={({ contracts }) => contracts.manager.relinkStudent(student.id, getAddress(target))}
      onClose={onClose}
    >
      <dl className={shared.summary}>
        <div>
          <dt>From</dt>
          <dd>
            <AddressChip address={student.wallet} explorer />
          </dd>
        </div>
        <div>
          <dt>Balance that moves</dt>
          <dd className="t-num t-mark">{formatAtc(student.balance)} ATC</dd>
        </div>
      </dl>
      <Field
        label="New wallet"
        error={error}
        hint={check.isFetching ? "Checking the wallet…" : "Paste the address from the student's new wallet."}
      >
        <Input
          mono
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="0x…"
          autoComplete="off"
          spellCheck={false}
          autoFocus
        />
      </Field>
      {paused ? (
        <p className={cx(shared.callout, shared.danger)} role="alert">
          AttendCoin is paused, and moving the balance is a transfer. Resume the token in Economy first.
        </p>
      ) : (
        <p className={shared.callout}>
          The whole balance of <strong className="t-num">{formatAtc(student.balance)} ATC</strong> moves from the old
          wallet to the new one in this transaction, and the old wallet is removed from the campus allowlist. Attendance
          history, streaks, enrolments and pending store redemptions are tied to the student number, so they follow
          automatically.
        </p>
      )}
    </TxDialog>
  );
}

function GrantDialog({
  role,
  holders,
  onClose,
}: {
  role: RoleKind;
  holders: RoleHolder[] | undefined;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const target = value.trim();
  const check = useWalletCheck(role === "teacher" ? target : "");
  const format = addressError(target);
  const already = !format && holders?.some((h) => h.account.toLowerCase() === target.toLowerCase());
  const noun = role === "teacher" ? "teacher" : "vendor";
  const error =
    (touched || target.length >= 42) && format
      ? format
      : already
        ? `That wallet is already a ${noun}.`
        : role === "teacher" && check.data?.studentId
          ? `That wallet is student #${check.data.studentId}. A wallet can't be both a teacher and a student.`
          : null;
  const ready = !format && !already && (role === "vendor" || (check.isSuccess && !check.data.studentId));

  return (
    <TxDialog
      title={`Add a ${noun}`}
      doneTitle={`${noun[0].toUpperCase()}${noun.slice(1)} added`}
      description={
        role === "teacher"
          ? "Teachers can be assigned courses, open sessions and mark attendance by hand."
          : "Vendors can fulfil redemptions at the store counter. They can't change prices or stock."
      }
      doneDescription={
        role === "teacher"
          ? "Assign them a course from the Courses page."
          : "They can open the Counter screen with this wallet now."
      }
      confirmLabel={`Add ${noun}`}
      txLabel={`Add ${noun}`}
      disabled={!ready}
      send={({ contracts }) =>
        role === "teacher"
          ? contracts.manager.grantRole(TEACHER_ROLE, getAddress(target))
          : contracts.store.grantRole(VENDOR_ROLE, getAddress(target))
      }
      onClose={onClose}
    >
      <Field label="Wallet address" error={error}>
        <Input
          mono
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="0x…"
          autoComplete="off"
          spellCheck={false}
          autoFocus
        />
      </Field>
    </TxDialog>
  );
}

function RevokeDialog({
  role,
  holder,
  courses,
  onClose,
}: {
  role: RoleKind;
  holder: RoleHolder;
  courses: AdminCourse[] | undefined;
  onClose: () => void;
}) {
  const { address } = useWallet();
  const taught =
    role === "teacher"
      ? (courses?.filter((c) => c.active && c.teacher.toLowerCase() === holder.account.toLowerCase()) ?? [])
      : [];
  const self = address?.toLowerCase() === holder.account.toLowerCase();
  const who = holder.name ?? `${holder.account.slice(0, 6)}…${holder.account.slice(-4)}`;
  return (
    <TxDialog
      title={`Remove ${who} as ${role}?`}
      doneTitle={`${who} removed`}
      description={
        role === "teacher"
          ? "They lose the teacher role and can no longer be assigned courses."
          : "They can no longer fulfil redemptions. Pending redemptions stay pending for another vendor."
      }
      doneDescription={
        taught.length ? "Assign their courses to another teacher from the Courses page." : "You can add them again later."
      }
      confirmLabel="Remove"
      tone="danger"
      txLabel={`Remove ${role} ${who}`}
      send={({ contracts }) =>
        role === "teacher"
          ? contracts.manager.revokeRole(TEACHER_ROLE, holder.account)
          : contracts.store.revokeRole(VENDOR_ROLE, holder.account)
      }
      onClose={onClose}
    >
      <dl className={shared.summary}>
        <div>
          <dt>Wallet</dt>
          <dd>
            <AddressChip address={holder.account} explorer />
          </dd>
        </div>
      </dl>
      {taught.length > 0 && (
        <p className={shared.callout}>
          They still teach {taught.map((c) => c.code).join(", ")}. Those courses keep them on record, but no one can
          run sessions there until you assign a new teacher.
        </p>
      )}
      {self && (
        <p className={cx(shared.callout, shared.danger)}>This is the wallet you're signed in with.</p>
      )}
    </TxDialog>
  );
}
