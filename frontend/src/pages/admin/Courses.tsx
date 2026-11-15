import { useQueryClient } from "@tanstack/react-query";
import { BookPlus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { api, type CourseMeta } from "@/lib/api";
import { describeError } from "@/lib/errors";
import { formatInteger, pluralize, shortAddress } from "@/lib/format";
import { useTx } from "@/lib/tx";
import { useContracts, useWallet } from "@/lib/wallet";
import { AddressChip } from "@/ui/AddressChip";
import { Badge } from "@/ui/Badge";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { EmptyState } from "@/ui/EmptyState";
import { Field, Input, Select, type SelectOption } from "@/ui/Field";
import { Page, PageHeader } from "@/ui/Page";
import { Panel } from "@/ui/Panel";
import { Table, type Column } from "@/ui/Table";
import { TxStatus } from "@/ui/TxStatus";
import { cx } from "@/ui/cx";
import {
  MAX_BATCH,
  useCourses,
  useRoleHolders,
  useStudents,
  type AdminCourse,
  type RoleHolder,
  type StudentRow,
} from "./data";
import { Steps } from "./Steps";
import { TxDialog } from "./TxDialog";
import shared from "./shared.module.css";
import styles from "./Courses.module.css";

type OpenDialog =
  | { kind: "create" }
  | { kind: "edit"; course: AdminCourse }
  | { kind: "status"; course: AdminCourse }
  | { kind: "enroll"; course: AdminCourse };

export function AdminCourses() {
  const courses = useCourses();
  const teachers = useRoleHolders("teacher");
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const close = () => setDialog(null);

  const teacherName = (account: string) =>
    teachers.data?.find((t) => t.account.toLowerCase() === account.toLowerCase())?.name ?? null;

  const columns: Column<AdminCourse>[] = [
    {
      key: "course",
      header: "Course",
      render: (c) => (
        <div className={shared.cell}>
          <span className={shared.primary}>
            <span className="t-mono">{c.code}</span>
          </span>
          <span className={cx(shared.secondary, !c.meta?.title && shared.missing)}>{c.meta?.title ?? "No title yet"}</span>
        </div>
      ),
    },
    {
      key: "teacher",
      header: "Teacher",
      hideOnMobile: true,
      render: (c) => <AddressChip address={c.teacher} name={teacherName(c.teacher)} />,
    },
    {
      key: "where",
      header: "Room and time",
      hideOnMobile: true,
      render: (c) =>
        c.meta?.room || c.meta?.schedule ? (
          <div className={shared.cell}>
            <span>{c.meta.room || "—"}</span>
            {c.meta.schedule && <span className={shared.secondary}>{c.meta.schedule}</span>}
          </div>
        ) : (
          <span className={shared.missing}>Not set</span>
        ),
    },
    { key: "enrolled", header: "Enrolled", numeric: true, align: "right", render: (c) => formatInteger(c.enrolledCount) },
    {
      key: "sessions",
      header: "Sessions",
      numeric: true,
      align: "right",
      hideOnMobile: true,
      render: (c) => formatInteger(c.sessionCount),
    },
    {
      key: "status",
      header: "Status",
      render: (c) =>
        c.active ? (
          <Badge tone="ink" dot>
            Active
          </Badge>
        ) : (
          <Badge tone="neutral">Inactive</Badge>
        ),
    },
    {
      key: "actions",
      header: <span className="visually-hidden">Actions</span>,
      align: "right",
      render: (c) => (
        <div className={shared.rowActions}>
          <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: "enroll", course: c })}>
            Enroll
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "edit", course: c })}>
            Edit
          </Button>
        </div>
      ),
    },
  ];

  const sorted = useMemo(() => courses.data && [...courses.data].sort((a, b) => Number(b.id - a.id)), [courses.data]);

  return (
    <Page>
      <PageHeader
        eyebrow="Admin"
        title="Courses"
        description="A course has an on-chain code and teacher. Title, room and schedule live in the directory."
        actions={
          <Button variant="primary" leading={<BookPlus size={16} />} onClick={() => setDialog({ kind: "create" })}>
            New course
          </Button>
        }
      />

      <Panel flush>
        {courses.error ? (
          <EmptyState
            tone="danger"
            title="Couldn't load courses"
            body={describeError(courses.error).message}
            action={
              <Button variant="secondary" onClick={() => void courses.refetch()}>
                Try again
              </Button>
            }
          />
        ) : (
          <Table
            label="Courses"
            columns={columns}
            rows={sorted}
            rowKey={(c) => c.id.toString()}
            loading={courses.isLoading}
            skeletonRows={4}
            empty={
              <EmptyState
                icon={<BookPlus size={20} />}
                title="No courses yet"
                body={
                  teachers.data?.length === 0
                    ? "Add a teacher first; every course needs one. Then create a course and enroll students."
                    : "Create a course, assign a teacher, then enroll students so their attendance earns ATC."
                }
                action={
                  teachers.data?.length === 0 ? (
                    <Button variant="primary" to="/admin/people?tab=teachers">
                      Add a teacher
                    </Button>
                  ) : (
                    <Button variant="primary" onClick={() => setDialog({ kind: "create" })}>
                      New course
                    </Button>
                  )
                }
              />
            }
          />
        )}
      </Panel>

      {dialog?.kind === "create" && <CreateDialog teachers={teachers.data} onClose={close} />}
      {dialog?.kind === "edit" && (
        <EditDialog
          course={dialog.course}
          teachers={teachers.data}
          onClose={close}
          onToggle={() => setDialog({ kind: "status", course: dialog.course })}
        />
      )}
      {dialog?.kind === "status" && <StatusDialog course={dialog.course} onClose={close} />}
      {dialog?.kind === "enroll" && <EnrollDialog course={dialog.course} onClose={close} />}
    </Page>
  );
}

function teacherOptions(teachers: RoleHolder[] | undefined, current?: string) {
  const list = teachers ?? [];
  const options: SelectOption[] = list.map((t) => ({
    value: t.account,
    label: t.name ? `${t.name} (${shortAddress(t.account)})` : t.account,
  }));
  // A revoked teacher can still be on record for a course; keep them visible but not selectable.
  if (current && !list.some((t) => t.account.toLowerCase() === current.toLowerCase())) {
    options.unshift({ value: current, label: `${shortAddress(current)} (no longer a teacher)`, disabled: true });
  }
  return options;
}

interface MetaForm {
  title: string;
  room: string;
  schedule: string;
}

function metaErrors(m: MetaForm) {
  return {
    title: !m.title.trim() ? "Give the course a title." : m.title.trim().length > 120 ? "Keep it under 120 characters." : null,
    room: m.room.trim().length > 60 ? "Keep it under 60 characters." : null,
    schedule: m.schedule.trim().length > 200 ? "Keep it under 200 characters." : null,
  };
}

function toMeta(m: MetaForm): CourseMeta {
  return { title: m.title.trim(), room: m.room.trim() || undefined, schedule: m.schedule.trim() || undefined };
}

function MetaFields({
  value,
  onChange,
  touched,
  onTouch,
}: {
  value: MetaForm;
  onChange: (m: MetaForm) => void;
  touched: boolean;
  onTouch: () => void;
}) {
  const errors = metaErrors(value);
  return (
    <>
      <Field label="Title" error={touched ? errors.title : null}>
        <Input
          value={value.title}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
          onBlur={onTouch}
          maxLength={120}
          placeholder="Distributed Systems"
        />
      </Field>
      <div className={shared.pair}>
        <Field label="Room" optional error={errors.room}>
          <Input value={value.room} onChange={(e) => onChange({ ...value, room: e.target.value })} maxLength={60} placeholder="LH-204" />
        </Field>
        <Field label="Schedule" optional error={errors.schedule}>
          <Input
            value={value.schedule}
            onChange={(e) => onChange({ ...value, schedule: e.target.value })}
            maxLength={200}
            placeholder="Mon and Wed, 10:00"
          />
        </Field>
      </div>
    </>
  );
}

function metaProblem(err: unknown): string {
  const e = describeError(err);
  return e.rejected ? "You declined the directory signature. The course exists; save its details to finish." : e.message;
}

type CreateStep = "form" | "chain" | "meta" | "done";

function CreateDialog({ teachers, onClose }: { teachers: RoleHolder[] | undefined; onClose: () => void }) {
  const { signer, provider } = useWallet();
  const { read } = useContracts();
  const queryClient = useQueryClient();
  const tx = useTx();
  const [code, setCode] = useState("");
  const [teacher, setTeacher] = useState("");
  const [meta, setMeta] = useState<MetaForm>({ title: "", room: "", schedule: "" });
  const [touched, setTouched] = useState(false);
  const [step, setStep] = useState<CreateStep>("form");
  const [courseId, setCourseId] = useState<bigint | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const trimmed = code.trim();
  const codeBytes = new TextEncoder().encode(trimmed).length;
  const codeError = touched && !trimmed ? "Enter a course code." : codeBytes > 32 ? "Codes are at most 32 bytes." : null;
  const errors = metaErrors(meta);
  const valid = trimmed && codeBytes <= 32 && teacher && !errors.title && !errors.room && !errors.schedule;
  const noTeachers = teachers?.length === 0;

  const saveMeta = async (id: bigint) => {
    if (!signer) return;
    setStep("meta");
    setSaving(true);
    setProblem(null);
    try {
      await api.admin.setCourseMeta(signer, id, toMeta(meta));
      await queryClient.invalidateQueries({ queryKey: ["chain"] });
      setStep("done");
    } catch (err) {
      setProblem(metaProblem(err));
    } finally {
      setSaving(false);
    }
  };

  const create = async () => {
    if (!read || !provider || !valid) return;
    setStep("chain");
    const id = await tx.run({
      label: `Create ${trimmed}`,
      quiet: true,
      send: ({ contracts }) => contracts.manager.createCourse(trimmed, teacher),
      onConfirmed: async ({ hash }) => {
        const receipt = await provider.getTransactionReceipt(hash);
        for (const log of receipt?.logs ?? []) {
          const parsed = (() => {
            try {
              return read.manager.interface.parseLog(log);
            } catch {
              return null;
            }
          })();
          if (parsed?.name === "CourseCreated") return parsed.args.courseId as bigint;
        }
        return read.manager.courseCount();
      },
    });
    if (id === undefined) {
      setStep("form");
      return;
    }
    setCourseId(id);
    await saveMeta(id);
  };

  const working = tx.busy || saving;
  const done = step === "done";
  const metaFailed = step === "meta" && !saving && problem;

  return (
    <Dialog
      open
      size="md"
      onClose={() => !working && onClose()}
      dismissible={!working && !metaFailed}
      title={done ? `${trimmed} created` : "New course"}
      description={
        done
          ? "Enroll students next. The teacher can open a session as soon as there's someone to check in."
          : "The code and teacher are written on-chain. The title, room and schedule are saved to the directory after."
      }
      footer={
        done ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : metaFailed && courseId != null ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Finish later
            </Button>
            <Button variant="primary" onClick={() => void saveMeta(courseId)}>
              Save details again
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={working}>
              Cancel
            </Button>
            <Button variant="primary" loading={working} disabled={!valid || noTeachers} onClick={() => void create()}>
              {tx.state.phase === "failed" ? "Try again" : "Create course"}
            </Button>
          </>
        )
      }
    >
      <div className={shared.dialogBody}>
        {step !== "form" && (
          <Steps
            steps={["Create on-chain", "Save details"]}
            active={done ? 2 : step === "chain" ? 0 : 1}
            working={working}
          />
        )}
        {noTeachers ? (
          <p className={shared.callout}>
            There are no teachers yet. Every course needs one.{" "}
            <Button size="sm" variant="ghost" to="/admin/people?tab=teachers">
              Add a teacher
            </Button>
          </p>
        ) : (
          !done && (
            <fieldset className={styles.fieldset} disabled={working || step === "meta"}>
              <div className={shared.pair}>
                <Field label="Code" error={codeError} hint="Short and stable, e.g. CS-301. Can't be changed later.">
                  <Input
                    mono
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    onBlur={() => setTouched(true)}
                    autoComplete="off"
                    autoFocus
                  />
                </Field>
                <Field label="Teacher">
                  <Select
                    value={teacher}
                    onChange={(e) => setTeacher(e.target.value)}
                    placeholder={teachers ? "Choose a teacher" : "Loading teachers…"}
                    options={teacherOptions(teachers)}
                  />
                </Field>
              </div>
              <MetaFields value={meta} onChange={setMeta} touched={touched} onTouch={() => setTouched(true)} />
            </fieldset>
          )
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

type EditStep = "form" | "meta" | "teacher" | "done";

function EditDialog({
  course,
  teachers,
  onClose,
  onToggle,
}: {
  course: AdminCourse;
  teachers: RoleHolder[] | undefined;
  onClose: () => void;
  onToggle: () => void;
}) {
  const { signer } = useWallet();
  const queryClient = useQueryClient();
  const tx = useTx();
  const original: MetaForm = {
    title: course.meta?.title ?? "",
    room: course.meta?.room ?? "",
    schedule: course.meta?.schedule ?? "",
  };
  const [meta, setMeta] = useState<MetaForm>(original);
  const [teacher, setTeacher] = useState(course.teacher);
  const [step, setStep] = useState<EditStep>("form");
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [metaSaved, setMetaSaved] = useState(false);

  const errors = metaErrors(meta);
  const metaChanged =
    !metaSaved &&
    (meta.title.trim() !== original.title || meta.room.trim() !== original.room || meta.schedule.trim() !== original.schedule);
  const teacherChanged = teacher.toLowerCase() !== course.teacher.toLowerCase();
  const valid = !errors.title && !errors.room && !errors.schedule;
  const working = saving || tx.busy;

  const save = async () => {
    if (!signer) return;
    setProblem(null);
    if (metaChanged) {
      setStep("meta");
      setSaving(true);
      try {
        await api.admin.setCourseMeta(signer, course.id, toMeta(meta));
        setMetaSaved(true);
        await queryClient.invalidateQueries({ queryKey: ["chain"] });
      } catch (err) {
        setProblem(describeError(err).message);
        setStep("form");
        return;
      } finally {
        setSaving(false);
      }
    }
    if (teacherChanged) {
      setStep("teacher");
      const ok = await tx.run({
        label: `Change teacher of ${course.code}`,
        quiet: true,
        send: ({ contracts }) => contracts.manager.setCourseTeacher(course.id, teacher),
        onConfirmed: () => true,
      });
      if (!ok) return;
    }
    setStep("done");
  };

  const steps = [metaChanged || metaSaved ? "Save details" : null, teacherChanged ? "Change teacher" : null].filter(
    (s): s is string => Boolean(s),
  );
  const active = step === "done" ? steps.length : step === "teacher" ? steps.indexOf("Change teacher") : 0;
  const done = step === "done";

  return (
    <Dialog
      open
      size="md"
      onClose={() => !working && onClose()}
      dismissible={!working}
      title={done ? `${course.code} updated` : `Edit ${course.code}`}
      description={done ? undefined : "The code is permanent. Everything else can change."}
      footer={
        done ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={working}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={working}
              disabled={!valid || (!metaChanged && !teacherChanged)}
              onClick={() => void save()}
            >
              {tx.state.phase === "failed" ? "Try again" : "Save changes"}
            </Button>
          </>
        )
      }
    >
      <div className={shared.dialogBody}>
        {step !== "form" && steps.length > 1 && <Steps steps={steps} active={active} working={working} />}
        {!done && (
          <fieldset className={styles.fieldset} disabled={working}>
            <MetaFields value={meta} onChange={setMeta} touched onTouch={() => undefined} />
            <Field
              label="Teacher"
              hint={teacherChanged ? "Changing the teacher is an on-chain transaction." : undefined}
            >
              <Select value={teacher} onChange={(e) => setTeacher(e.target.value)} options={teacherOptions(teachers, course.teacher)} />
            </Field>
          </fieldset>
        )}
        {!done && (
          <div className={styles.statusRow}>
            <div>
              <p className={styles.statusTitle}>{course.active ? "Course is active" : "Course is inactive"}</p>
              <p className={shared.note}>
                {course.active
                  ? "Deactivating stops new sessions and closes any session that's open."
                  : "Reactivate it so the teacher can open sessions again."}
              </p>
            </div>
            <Button size="sm" variant={course.active ? "danger" : "secondary"} disabled={working} onClick={onToggle}>
              {course.active ? "Deactivate" : "Reactivate"}
            </Button>
          </div>
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

function StatusDialog({ course, onClose }: { course: AdminCourse; onClose: () => void }) {
  const deactivate = course.active;
  return (
    <TxDialog
      title={deactivate ? `Deactivate ${course.code}?` : `Reactivate ${course.code}?`}
      doneTitle={deactivate ? `${course.code} is inactive` : `${course.code} is active`}
      description={
        deactivate
          ? "No new sessions can be opened, and a session that's open now stops accepting check-ins immediately. Enrolments and earned ATC are kept."
          : "The teacher can open sessions again and enrolled students earn ATC for attending."
      }
      confirmLabel={deactivate ? "Deactivate course" : "Reactivate course"}
      tone={deactivate ? "danger" : "primary"}
      txLabel={`${deactivate ? "Deactivate" : "Reactivate"} ${course.code}`}
      send={({ contracts }) => contracts.manager.setCourseActive(course.id, !deactivate)}
      onClose={onClose}
    />
  );
}

function EnrollDialog({ course, onClose }: { course: AdminCourse; onClose: () => void }) {
  const students = useStudents();
  const tx = useTx();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [enrolled, setEnrolled] = useState(0);

  const candidates = useMemo(
    () => students.data?.students.filter((s) => !s.courses.includes(course.id)) ?? [],
    [students.data, course.id],
  );
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase().replace(/^#/, "");
    if (!q) return candidates;
    return candidates.filter(
      (s) => s.id.toString() === q || s.wallet.toLowerCase().includes(q) || s.name?.toLowerCase().includes(q),
    );
  }, [candidates, search]);

  const full = selected.size >= MAX_BATCH;
  const toggle = (s: StudentRow) =>
    setSelected((prev) => {
      const next = new Set(prev);
      const key = s.id.toString();
      if (next.has(key)) next.delete(key);
      else if (next.size < MAX_BATCH) next.add(key);
      return next;
    });
  const allVisibleSelected = visible.length > 0 && visible.every((s) => selected.has(s.id.toString()));
  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) for (const s of visible) next.delete(s.id.toString());
      else for (const s of visible) if (next.size < MAX_BATCH) next.add(s.id.toString());
      return next;
    });

  const done = tx.state.phase === "confirmed";

  const enroll = async () => {
    const ids = [...selected].map(BigInt);
    const ok = await tx.run({
      label: `Enroll ${pluralize(ids.length, "student")} in ${course.code}`,
      quiet: true,
      send: ({ contracts }) => contracts.manager.enrollStudents(course.id, ids),
      onConfirmed: () => true,
    });
    if (ok) {
      setEnrolled(ids.length);
      setSelected(new Set());
    }
  };

  return (
    <Dialog
      open
      size="md"
      onClose={() => !tx.busy && onClose()}
      dismissible={!tx.busy}
      title={done ? `${pluralize(enrolled, "student")} enrolled` : `Enroll students in ${course.code}`}
      description={
        done
          ? `They'll see ${course.code} on their dashboard and earn ATC from the next session.`
          : `${pluralize(course.enrolledCount, "student")} already enrolled. Up to ${MAX_BATCH} can be added per transaction.`
      }
      footer={
        done ? (
          <>
            <Button variant="ghost" onClick={() => tx.reset()}>
              Enroll more
            </Button>
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={tx.busy}>
              Cancel
            </Button>
            <Button variant="primary" loading={tx.busy} disabled={selected.size === 0} onClick={() => void enroll()}>
              {selected.size ? `Enroll ${pluralize(selected.size, "student")}` : "Enroll"}
            </Button>
          </>
        )
      }
    >
      <div className={shared.dialogBody}>
        {!done &&
          (students.isLoading ? (
            <div className={styles.pickList} aria-busy="true">
              <p className={cx(shared.note, styles.pickEmpty)}>Loading students…</p>
            </div>
          ) : students.error ? (
            <EmptyState
              compact
              tone="danger"
              title="Couldn't load students"
              body={describeError(students.error).message}
              action={
                <Button size="sm" variant="secondary" onClick={() => void students.refetch()}>
                  Try again
                </Button>
              }
            />
          ) : candidates.length === 0 ? (
            <EmptyState
              compact
              title={students.data?.students.length ? "Everyone is enrolled" : "No students registered"}
              body={
                students.data?.students.length
                  ? `Every registered student is already in ${course.code}.`
                  : "Register students on the People page first."
              }
              action={
                !students.data?.students.length && (
                  <Button size="sm" variant="secondary" to="/admin/people?register=1">
                    Register a student
                  </Button>
                )
              }
            />
          ) : (
            <>
              <div className={styles.pickBar}>
                <Input
                  type="search"
                  placeholder="Name, wallet or #id"
                  aria-label="Filter students"
                  prefix={<Search size={14} />}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className={styles.pickSearch}
                />
                <label className={shared.check}>
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} disabled={tx.busy} />
                  {search ? "Select matches" : "Select all"}
                </label>
              </div>
              <ul className={styles.pickList} aria-label="Students not yet enrolled">
                {visible.length === 0 && <li className={cx(shared.note, styles.pickEmpty)}>No students match.</li>}
                {visible.map((s) => {
                  const key = s.id.toString();
                  const checked = selected.has(key);
                  return (
                    <li key={key}>
                      <label className={cx(styles.pick, checked && styles.picked)}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={tx.busy || (!checked && full)}
                          onChange={() => toggle(s)}
                        />
                        <span className={shared.cell}>
                          <span className={cx(shared.primary, !s.name && shared.missing)}>{s.name ?? "No profile"}</span>
                          <span className={cx(shared.secondary, "t-mono")}>
                            #{key} · {shortAddress(s.wallet)}
                          </span>
                        </span>
                        {!s.active && <Badge tone="neutral">Inactive</Badge>}
                      </label>
                    </li>
                  );
                })}
              </ul>
              <p className={shared.toolbarNote} aria-live="polite">
                <span className="t-num">{formatInteger(selected.size)}</span> selected
                {full && ` · the limit for one transaction is ${MAX_BATCH}`}
              </p>
            </>
          ))}
        <TxStatus state={tx.state} />
      </div>
    </Dialog>
  );
}
